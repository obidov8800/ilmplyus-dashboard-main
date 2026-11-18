import { useBulkDelete } from '@/hooks/useBulkDelete';
import { usePermission } from '@/hooks/usePermission';
import { useOptions } from '@/hooks/useOptions';
import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { API } from "../../api/api";
import "./contracts.css";
import { useTranslation } from "react-i18next";
import { getLocalized } from "../../utils/getLocalized";
import ContractsCreate from "./ContractsCreate";
import { Protected } from "@/components/Protected";
import { useTableColumns } from "../../hooks/useTableColumns";
import PaginationBar from "@/components/Pagination/PaginationBar";
import WorkScheduleModal from "@/components/WorkScheduleModal";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import { formatDate as formatDisplayDate } from "@/utils/date";
import { printFromDocxTemplate } from "@/utils/contractPdf";
import { buildEmployeeContractData } from "@/utils/employeeContractPdf";
import employmentTemplate from "@/assets/documents/ILM_PLYUS_Mehnat_shartnomasi_TEMPLATE.docx?url";
import { notifyError } from '@/utils/notify';
import { ActiveBadge } from '@/components/StatusBadge';

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  middle_name: string;
  full_name: string;
  phone: string;
  birth_date: string;
  pinfl: string;
  citizenship: string;
  passport_series: string;
  passport_number: string;
  passport_given_date: string;
  passport_given_by: string;
  address_registration: string;
  address_living: string;
  photo_url?: string;
  branch_id?: number;
}

interface Department {
  id: number;
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
  code?: string;
  is_pedagogical?: boolean;
}

const isPedagogical = (department?: Department | null) => {
  if (!department) return false;
  if (department.is_pedagogical) return true;
  const text = [department.code, department.name_uz, department.name_ru, department.name_en]
    .filter(Boolean).join(' ').toLowerCase().replace(/[ʼ’‘'`ʻ]/g, '');
  return text.includes('pedagog') || text.includes('педагог');
};

interface BranchRekvizit {
  id: number;
  name_uz?: string | null;
  legal_name?: string | null;
  city?: string | null;
  address_uz?: string | null;
  legal_address_uz?: string | null;
  inn?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  mfo?: string | null;
  director_name?: string | null;
  oked?: string | null;
}

interface Contract {
  id: number;
  employee_id: number;
  contract_number: number;
  contract_date: string;
  contract_start_date: string;
  contract_end_date: string;
  status: string;
  base_salary: string;
  employee: Employee;
  department: Department;
  position_id: number;
  position?: {
    id: number;
    name_uz: string | null;
    name_ru: string | null;
    name_en: string | null;
  };
  contract_type: string;
  contract_duration_months?: string | null;
  monthly_salary_type?: string | null;
  work_start_date?: string | null;
  vacation_type: string;
  vacation_days?: number | string | null;
  working_hours_monthly: string;
  hourly_rate: string;
  total_monthly_salary: string;
  salary_start_date: string;
  salary_end_date: string;
  signed_by: string;
  language: string;
  probation_period: string | null;
  probation_end_date: string | null;
  branch_id?: number;
  /** Word shablonidagi NTM rekvizitlari (STIR, MFO, bank, H/R, rahbar) uchun. */
  branch?: BranchRekvizit;
}

const Contracts: React.FC = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('contracts');
  // (id) + ustunlar + amallar
  const colCount = 1 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [branchFilter, setBranchFilter] = useState('');
  const [editContract, setEditContract] = useState<{
    employeeId: number;
    contractId: number;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Shartnoma sahifasidan «Qayta shartnoma» / «Qo'shimcha shartnoma» bosilganda shu yerda forma ochiladi.
  const location = useLocation();
  const [createFor, setCreateFor] = useState<{
    employeeId: number;
    fromContractId: number;
    mode: "renew" | "additional";
  } | null>(
    () =>
      (location.state as { newContractFor?: { employeeId: number; fromContractId: number; mode: "renew" | "additional" } } | null)
        ?.newContractFor ?? null,
  );
  useEffect(() => {
    if ((location.state as { newContractFor?: unknown } | null)?.newContractFor) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [workTimeEmployeeId, setWorkTimeEmployeeId] = useState<number | null>(null);
  const [busyDoc, setBusyDoc] = useState<{
    contractId: number;
    mode: "pdf" | "print";
  } | null>(null);

  const {
    data: contracts,
    isLoading,
    isError,
  } = useQuery<Contract[]>({
    queryKey: ["contracts"],
    queryFn: async () => {
      const { data } = await API.get("/contracts");
      return data;
    },
  });

  /**
   * `GET /contracts` shartnoma bilan birga `branch` relation'ini qaytarmaydi, shuning
   * uchun Word shablonidagi NTM rekvizitlari (STIR, MFO, bank, H/R, manzil, rahbar)
   * bo'sh chiqardi. Rekvizitlar bor to'liq ro'yxat `/branches` dan — faqat `branches.view` bo'lsa so'raladi;
   * bo'lmasa `/options/branches` (nom va shahar; bank rekvizitlari hujjatda «—», backend topshirig'i bilan qo'shiladi).
   */
  const canViewBranches = usePermission('branches.view');
  const { data: fullBranches } = useQuery<BranchRekvizit[]>({
    queryKey: ["branches"],
    queryFn: async () => {
      const { data } = await API.get("/branches");
      return Array.isArray(data) ? data : data?.data || [];
    },
    enabled: canViewBranches,
    staleTime: 5 * 60 * 1000,
  });
  const { data: branchOptions = [] } = useOptions('branches', undefined, { enabled: !canViewBranches });
  const { data: positionOptions = [] } = useOptions('positions');
  const branches = useMemo<BranchRekvizit[] | undefined>(
    () =>
      canViewBranches
        ? fullBranches
        : branchOptions.map((o) => ({ id: o.id, name_uz: o.label, city: o.city }) as BranchRekvizit),
    [canViewBranches, fullBranches, branchOptions],
  );

  /** Shartnoma filiali (`contract.branch`) — xodimning asosiy filiali (`employee.branch`) emas. */
  const contractBranchName = (c: Contract): string => {
    const id = c.branch_id ?? c.branch?.id ?? c.employee?.branch_id;
    const full = branches?.find((b) => b.id === Number(id));
    return (
      (c.branch ? getLocalized(c.branch, "name", i18n.language) : "") ||
      (full ? getLocalized(full, "name", i18n.language) || full.name_uz || "" : "") ||
      "-"
    );
  };

  const processedData = useMemo(() => {
    if (!contracts) return [];
    // Eng oxirgi qo'shilgan shartnoma jadval boshida turishi kerak. sortByNewest
    // avval `created_at` ga qaraydi, u esa bu yerda ishonchli emas — id bo'yicha saralaymiz.
    return [...contracts]
      .filter((c) => {
        if (!branchFilter) return true;
        const branchId = c.branch_id ?? c.branch?.id ?? c.employee?.branch_id;
        return String(branchId) === branchFilter;
      })
      .sort((a, b) => b.id - a.id);
  }, [contracts, branchFilter]);

  const totalPages = Math.max(1, Math.ceil(processedData.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, safePage, pageSize]);

  const bulkAllowed = usePermission('employee_contracts.delete');
  const bulk = useBulkDelete({ rows: paginatedData, allowed: bulkAllowed, scope: JSON.stringify([safePage, pageSize, branchFilter]), remove: row => API.delete(`/employees/${row.employee_id ?? row.employee?.id}/contracts/${row.id}`), refresh: () => queryClient.invalidateQueries({ queryKey: ['contracts'] }) });
  const deleteMutation = useMutation({
    mutationFn: async ({
      employeeId,
      contractId,
    }: {
      employeeId: number;
      contractId: number;
    }) => {
      await API.delete(`/employees/${employeeId}/contracts/${contractId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
    },
  });

  const [pendingDelete, setPendingDelete] = useState<{
    employeeId: number;
    contractId: number;
  } | null>(null);

  const handleDelete = (employeeId: number, contractId: number) => {
    setPendingDelete({ employeeId, contractId });
  };

  /**
   * Mehnat shartnomasini Word shabloni asosida PDF/chop etishga uzatadi.
   * Jadvaldagi shartnoma obyekti ishlatiladi — alohida so'rov yuborilmaydi
   * (backendda GET /contracts/{id} yo'q). Yagona istisno: `branch` javobda
   * kelmagani uchun `/branches` ro'yxatidan `branch_id` bo'yicha topib qo'shiladi.
   *
   * O'quvchi shartnomalari bilan bir xil `printFromDocxTemplate` chaqiriladi,
   * shuning uchun PDF/print parametrlari aynan bir xil bo'ladi.
   */
  const handleGenerate = async (contract: Contract, mode: "pdf" | "print") => {
    setBusyDoc({ contractId: contract.id, mode });
    try {
      // Shartnoma filiali; rekvizitlar (STIR, MFO, bank…) to'liq ro'yxatdan — `contract.branch` da faqat nom keladi.
      const branchId = contract.branch_id ?? contract.branch?.id ?? contract.employee?.branch_id;
      const full = branches?.find((b) => b.id === Number(branchId));
      const branch = full ? { ...(contract.branch ?? {}), ...full } : contract.branch;

      // `GET /contracts` javobida `position` munosabati kelmaydi (faqat `position_id`) — hujjatdagi lavozim
      // «—» bo'lib qolardi. Nomi lavozimlar ro'yxatidan olinadi.
      const position =
        contract.position ??
        (contract.position_id
          ? (() => {
              const o = positionOptions.find((p) => p.id === Number(contract.position_id));
              return o ? { id: o.id, name_uz: o.label, name_ru: o.label, name_en: o.label } : undefined;
            })()
          : undefined);
      const templateData = buildEmployeeContractData({ ...contract, branch, position });
      const contractNumber = String(contract.contract_number ?? contract.id);

      // PDF ko'ruvchida ochiladi (pdf) yoki darhol chop etiladi (print) — brauzer yozuvlarisiz.
      await printFromDocxTemplate(employmentTemplate, templateData, contractNumber, mode);
    } catch (err) {
      console.error(`${mode} xatosi:`, err);
      notifyError(t(mode === "pdf" ? "contracts.pdfError" : "contracts.printError"));
    } finally {
      setBusyDoc(null);
    }
  };

  const formatDate = (dateStr: string) => formatDisplayDate(dateStr, "-");

  if (createFor) {
    return (
      <ContractsCreate
        employeeId={createFor.employeeId}
        sourceContractId={createFor.fromContractId}
        mode={createFor.mode}
        onCancel={() => setCreateFor(null)}
        onSuccess={() => setCreateFor(null)}
      />
    );
  }

  if (isCreating) {
    return (
      <ContractsCreate
        onCancel={() => setIsCreating(false)}
        onSuccess={() => setIsCreating(false)}
      />
    );
  }

  if (editContract) {
    return (
      <ContractsCreate
        employeeId={editContract.employeeId}
        contractId={editContract.contractId}
        onCancel={() => setEditContract(null)}
        onSuccess={() => setEditContract(null)}
      />
    );
  }

  return (
    <div className="contracts-container container">
      {workTimeEmployeeId !== null && (
        <WorkScheduleModal
          userId={workTimeEmployeeId}
          idKey="employee_id"
          onClose={() => setWorkTimeEmployeeId(null)}
        />
      )}

      <ConfirmDeleteModal
        open={!!pendingDelete}
        title={t("contracts.deleteConfirm")}
        busy={deleteMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
      />

      <div className="contracts-header">
        <h1>
          <div className="icon-box">
            <i className="fas fa-file-contract"></i>
          </div>
          {t("contracts.title")}
        </h1>
      </div>

      {bulk.modal}
      <div className="contracts-filters">
        {bulk.button}
        <button className="btn btn-save" onClick={() => setIsCreating(true)}>
          <i className="fas fa-plus"></i> {t("contracts.newContract")}
        </button>
        <select
          className="contracts-branch-filter"
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
        >
          <option value="">{t("contracts.filterBranch", "Filial")}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name_uz}
            </option>
          ))}
        </select>
      </div>

      <div className="contracts-table-card">
        <table className="contracts-table">
          <thead>
            <tr>
              {bulk.header}
              {isVisible('id') && <th>{t("contracts.table.id")}</th>}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t("contracts.table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount + bulk.columnCount} align="center">
                  {t("contracts.loading")}
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={colCount + bulk.columnCount} align="center">
                  {t("contracts.error")}
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={colCount + bulk.columnCount} align="center">
                  {t("contracts.noData")}
                </td>
              </tr>
            ) : (
              paginatedData?.map((contract) => {
                const emp = contract.employee || {};
                return (
                  <tr key={contract.id}>
                    {bulk.cell(contract)}
                    {isVisible('id') && <td>{contract.id}</td>}
                    {visibleColumns.map((colId) => {
                      switch (colId) {
                        case 'full_name':
                          return (
                            <td key={colId}>
                              {emp.full_name ||
                                `${emp.last_name || ""} ${emp.first_name || ""} ${emp.middle_name || ""}`.trim() ||
                                (contract.employee ? "-" : t("contracts.employeeDeleted"))}
                            </td>
                          );
                        case 'phone':
                          return <td key={colId}>{emp.phone || "-"}</td>;
                        case 'department':
                          return (
                            <td key={colId}>
                              {getLocalized(contract.department, "name", i18n.language)}
                            </td>
                          );
                        case 'branch':
                          return <td key={colId}>{contractBranchName(contract)}</td>;
                        case 'status':
                          return (
                            <td key={colId}>
                              <ActiveBadge
                                active={contract.status === "active"}
                                activeLabel={t("contracts.status.active")}
                                inactiveLabel={t("contracts.status.inactive")}
                              />
                            </td>
                          );
                        case 'start_date':
                          return <td key={colId}>{formatDate(contract.contract_start_date)}</td>;
                        case 'end_date':
                          return <td key={colId}>{formatDate(contract.contract_end_date)}</td>;
                        default:
                          return <td key={colId}>-</td>;
                      }
                    })}
                    <td>
                      <div className={contract.employee ? "action-btns" : "action-btns is-orphan"} title={contract.employee ? undefined : t("contracts.employeeDeleted")}>
                        <Protected permission="work_schedules.view">
                          {isPedagogical(contract.department) ? (
                            // O'qituvchi: ish jadvali kiritilmaydi (davomat dars jadvalidan) — belgi o'chirilgan, sababi yozilgan.
                            <div
                              className="action-icon work-time-icon"
                              style={{ opacity: 0.35, cursor: "not-allowed" }}
                              title={t("workSchedule.teacherNote")}
                            >
                              <i className="fa-solid fa-clock"></i>
                            </div>
                          ) : (
                            <div
                              className="action-icon work-time-icon"
                              onClick={() => setWorkTimeEmployeeId((contract.employee_id ?? emp.id))}
                              title={t("workSchedule.title")}
                            >
                              <i className="fa-solid fa-clock"></i>
                            </div>
                          )}
                        </Protected>
                        <Protected permission="employee_contracts.show">
                          <div
                            className="action-icon view-icon"
                            onClick={() => navigate(`/contracts/${contract.id}`)}
                            title={t("contracts.actions.view")}
                          >
                            <i className="fas fa-eye"></i>
                          </div>
                        </Protected>
                        <Protected permission="employee_contracts.edit">
                          <div
                            className="action-icon edit-icon"
                            onClick={() =>
                              setEditContract({
                                employeeId: (contract.employee_id ?? emp.id),
                                contractId: contract.id,
                              })
                            }
                            title={t("contracts.actions.edit")}
                          >
                            <i className="fas fa-pen"></i>
                          </div>
                        </Protected>
                        <Protected permission="payroll_distributions.create">
                          <div
                            className="action-icon salary-icon"
                            onClick={() => navigate(`/payroll/distributions/${(contract.employee_id ?? emp.id)}${contract.branch_id ? `?branch=${contract.branch_id}` : ""}`)}
                            title={t("contracts.actions.salary")}
                          >
                            <i className="fas fa-coins"></i>
                          </div>
                        </Protected>
                        <div
                          className="action-icon pdf-icon"
                          onClick={() => !busyDoc && handleGenerate(contract, "pdf")}
                          title={t("contracts.actions.pdf")}
                          style={{
                            pointerEvents: busyDoc ? "none" : "auto",
                            opacity: busyDoc ? 0.5 : 1,
                          }}
                        >
                          <i
                            className={
                              busyDoc?.contractId === contract.id && busyDoc.mode === "pdf"
                                ? "fas fa-spinner fa-spin"
                                : "fas fa-file-pdf"
                            }
                          ></i>
                        </div>
                        <div
                          className="action-icon print-icon"
                          onClick={() => !busyDoc && handleGenerate(contract, "print")}
                          title={t("contracts.actions.print")}
                          style={{
                            pointerEvents: busyDoc ? "none" : "auto",
                            opacity: busyDoc ? 0.5 : 1,
                          }}
                        >
                          <i
                            className={
                              busyDoc?.contractId === contract.id && busyDoc.mode === "print"
                                ? "fas fa-spinner fa-spin"
                                : "fas fa-print"
                            }
                          ></i>
                        </div>
                        <Protected permission="employee_contracts.delete">
                          <div
                            className="action-icon delete-icon"
                            onClick={() => handleDelete((contract.employee_id ?? emp.id), contract.id)}
                            title={t("contracts.actions.delete")}
                            style={{
                              pointerEvents: deleteMutation.isPending ? "none" : "auto",
                              opacity: deleteMutation.isPending ? 0.5 : 1,
                            }}
                          >
                            <i className="fas fa-trash"></i>
                          </div>
                        </Protected>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && processedData.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          total={processedData.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
};

export default Contracts;
