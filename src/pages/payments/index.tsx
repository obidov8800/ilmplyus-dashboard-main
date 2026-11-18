import { useState, useMemo } from 'react';
import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { API } from '../../api/api';
import './payments.css';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import type { Payment, PaymentPayload } from '../../types';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions, type OptionItem } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useDragScroll } from '../../hooks/useDragScroll';
import { formatDate, toTashkentDate } from '@/utils/date';
import { notifyWarning } from '@/utils/notify';
import { normalizePaymentPeriod, periodLabel, periodOfDate } from '@/utils/paymentPeriod';
import { isPreschoolBranch } from '@/utils/branchType';
import { formatSum } from '@/api/preschool';
import { fetchStudentMonths, suggestedPeriod } from '@/api/preschoolPayments';
import AccessNotice from '@/components/AccessNotice';
import { findStudentByAccount, normalizeAccount } from '@/utils/studentAccount';
import { usePermission } from '@/hooks/usePermission';
import { fetchOptions } from '@/api/options';

interface Commission {
  payment_method: string;
}

const KNOWN_PAYMENT_METHODS = ['cash', 'card', 'bank', 'click', 'paynet'];

const Payments = () => {
  const { isVisible, visibleColumns } = useTableColumns('payments');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [viewItem, setViewItem] = useState<Payment | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [search, setSearch] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [paymentTypeFilter, setPaymentTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [formData, setFormData] = useState({
    student_id: '',
    student_code: '',
    amount: '',
    payment_type: '',
    course_id: '',
    teacher_id: '',
    cashier_id: '',
    branch_id: '',
    payment_date: '',
    /** To'lov oyi, `YYYY-MM` (maktabga tayyorlov filialda tanlanadi); bo'sh — to'lov sanasi oyi. */
    payment_period: '',
    group_id: '',
    created_at: '',
    updated_at: '',
  });

  const { data: paymentsRaw, isLoading } = useQuery<unknown>({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data } = await API.get('/payments');
      return data;
    },
    placeholderData: keepPreviousData,
  });

  // `/payments` barcha yozuvlarni bitta javobda qaytaradi va `page`/`per_page`/
  // `branch_id`/`payment_method` parametrlarini e'tiborsiz qoldiradi. Shu sabab
  // filtr/qidiruv BUTUN ro'yxatga qo'llanadi, sahifalash esa undan keyin klient
  // tomonda bajariladi — aks holda filtrlar faqat ekrandagi 20 qatorni filtrlardi.
  const allPayments = useMemo<Payment[]>(() => {
    if (Array.isArray(paymentsRaw)) return paymentsRaw as Payment[];
    const d = (paymentsRaw as { data?: unknown } | null)?.data;
    return Array.isArray(d) ? (d as Payment[]) : [];
  }, [paymentsRaw]);

  const { data: branchesData } = useOptions('branches');
  const { data: employeesData } = useOptions('teachers');
  const { data: usersData } = useOptions('users');
  const { data: coursesData } = useOptions('courses');
  const { data: studentsData } = useOptions('students');

  const selectedStudent = studentsData?.find((s) => String(s.id) === formData.student_id);

  // Maktabga tayyorlov (preschool) filialda guruhning kursi yo'q (backend: `course_id` ixtiyoriy) va to'lov qaysi oy uchun
  // ekani tanlanadi (`payment_period`, `YYYY-MM`) — jurnaldagi oylik to'lov holati shu oyga yoziladi.
  const isPreschoolPayment = isPreschoolBranch(
    branchesData?.find((b) => String(b.id) === formData.branch_id),
  );

  // Maktabga tayyorlovda balans yo'q — har oy alohida: to'langan / oylik narx / qarz (jurnal endpointidan, o'quvchi
  // guruhga qo'shilgan oydan boshlab). Jurnal ruxsati bo'lmasa so'rov jim xato beradi: panel chiqmaydi, summa cheklanmaydi.
  const monthsQuery = useQuery({
    // `payments` bilan boshlanadi — to'lov saqlangach ro'yxat bilan birga qayta yuklanadi.
    queryKey: ['payments', 'preschool-months', formData.group_id, formData.student_id],
    queryFn: () => fetchStudentMonths(Number(formData.group_id), Number(formData.student_id)),
    enabled: showAddModal && isPreschoolPayment && !!formData.group_id && !!formData.student_id,
    retry: false,
    staleTime: 0,
  });
  const monthsData = isPreschoolPayment ? monthsQuery.data : undefined;
  // Tanlangan oy; tanlanmagan bo'lsa — eng eski qarzdor oy (jurnal yuklangach), aks holda to'lov sanasi oyi.
  const formPeriod =
    formData.payment_period ||
    (monthsData
      ? suggestedPeriod(monthsData)
      : periodOfDate(formData.payment_date || toTashkentDate(new Date())));
  const monthRow = monthsData?.months.find((m) => m.period === formPeriod);

  // Tanlangan oy uchun ko'pi bilan to'lanadigan summa = oylik narx − shu oyda to'langan. Tahrirlanayotgan to'lovning
  // o'z summasi o'sha oy hisobida allaqachon bor — uni qaytarib qo'shamiz. `null` — narx yo'q, cheklov yo'q.
  const editedPeriod = editingPayment
    ? (normalizePaymentPeriod(editingPayment.payment_period) ??
      periodOfDate(String(editingPayment.payment_date || editingPayment.created_at || '')))
    : null;
  const ownAmount =
    editingPayment &&
    editedPeriod === formPeriod &&
    String(editingPayment.student_id) === formData.student_id
      ? Number(editingPayment.amount) || 0
      : 0;
  const monthLimit = monthRow && monthRow.debt !== null ? monthRow.debt + ownAmount : null;
  const monthFullyPaid = monthLimit !== null && monthLimit <= 0;
  const amountNumber = Number(formData.amount) || 0;
  const overLimit = monthLimit !== null && amountNumber > monthLimit;

  // Guruhlar o'quvchining filiali bo'yicha filtrlanadi; tahrirlashda barchasi ko'rinadi.
  const groupBranchId = editingPayment
    ? undefined
    : (selectedStudent?.branch_id as number | undefined);
  const { data: groupsData } = useOptions('groups', { branch_id: groupBranchId });
  const groupOptions = useMemo(() => groupsData ?? [], [groupsData]);

  const applyStudentSelection = (student: OptionItem) => {
    // /options/students endi o'quvchining groups[] va courses[] ro'yxatini qaytaradi.
    // courses[] elementiga backend group_id qo'shib beradi — kurs shu orqali guruhga bog'lanadi.
    const studentGroups = Array.isArray(student.groups)
      ? (student.groups as { id: number; label?: string }[])
      : [];
    const studentCourses = Array.isArray(student.courses)
      ? (student.courses as { id: number; label?: string; group_id?: number }[])
      : [];

    const firstGroup = studentGroups[0];
    const linkedCourse = firstGroup
      ? (studentCourses.find((c) => Number(c.group_id) === Number(firstGroup.id)) ??
        studentCourses[0])
      : studentCourses[0];

    setFormData((prev) => ({
      ...prev,
      student_id: String(student.id),
      student_code: String(student.student_code ?? ''),
      branch_id: String(student.branch_id ?? ''),
      payment_type: String(student.branch_id ?? '') === prev.branch_id ? prev.payment_type : '',
      group_id: firstGroup ? String(firstGroup.id) : '',
      course_id: linkedCourse ? String(linkedCourse.id) : '',
      teacher_id: '',
      // Yangi o'quvchining eng eski qarzdor oyi qayta taklif qilinadi
      payment_period: '',
    }));
  };

  // Tanlangan guruhdan kurs/o'qituvchi avto-to'ldiriladi. Guruhlar ro'yxati
  // o'quvchi tanlangandan keyin filial bo'yicha yuklanadi, shuning uchun bu
  // qiymatlar state'ga yozilmaydi — render vaqtida hisoblanadi. Foydalanuvchi
  // qo'lda tanlagan bo'lsa (formData'da qiymat bor) o'shanisi ustun turadi.
  const groupOfForm = groupOptions.find((g) => String(g.id) === formData.group_id);
  const effectiveCourseId =
    formData.course_id || (groupOfForm?.course_id ? String(groupOfForm.course_id) : '');
  const effectiveTeacherId =
    formData.teacher_id || (groupOfForm?.teacher_id ? String(groupOfForm.teacher_id) : '');

  // Kurs/guruh selectlarida faqat tanlangan o'quvchiga tegishli ro'yxat chiqadi
  // (/options/students dagi groups[] va courses[]). Tahrirlashda o'quvchi options
  // ro'yxatida topilmasa, eski to'lovlar buzilmasligi uchun to'liq ro'yxat qoladi.
  const studentGroupList = Array.isArray(selectedStudent?.groups)
    ? (selectedStudent?.groups as { id: number; label?: string }[])
    : [];
  const studentCourseList = Array.isArray(selectedStudent?.courses)
    ? (selectedStudent?.courses as { id: number; label?: string; group_id?: number }[])
    : [];
  const modalGroupOptions = selectedStudent ? studentGroupList : editingPayment ? groupOptions : [];
  const modalCourseOptions = selectedStudent
    ? studentCourseList
    : editingPayment
      ? (coursesData ?? [])
      : [];

  // Hisob raqami IXTIYORIY: bo'sh qoldirilsa o'quvchi ro'yxatdan tanlanadi. Raqam (faqat o'quvchi kodi yoki filial kodi
  // bilan to'liq raqam) kiritilsa mos o'quvchi o'zi tanlanadi. Mos kelmasa o'quvchi tanlovi tozalanadi — aks holda
  // maydonda boshqa raqam, saqlanadigan to'lov esa avval tanlangan o'quvchiga tegishli bo'lib qolardi.
  const handleAccountNumberChange = (value: string) => {
    const found = findStudentByAccount(studentsData ?? [], value);
    if (found) {
      applyStudentSelection(found.student);
    } else {
      setFormData((prev) => ({ ...prev, student_code: value, student_id: '' }));
    }
  };
  const accountEntered = normalizeAccount(formData.student_code) !== '';
  const accountMissing = accountEntered && !selectedStudent && !!studentsData;

  // Filial komissiyalari: `payment_gateway_commissions.view` bo'lsa `/branches/{id}/commissions`, bo'lmasa tanlov
  // ro'yxati `/options/payment-gateway-commissions?branch_id=` (sahifaga `payments.*` yetadi).
  const canViewCommissions = usePermission('payment_gateway_commissions.view');
  const loadCommissions = async (branchId: number | string): Promise<Commission[]> => {
    if (!canViewCommissions) {
      return (await fetchOptions('payment-gateway-commissions', { branch_id: branchId })) as unknown as Commission[];
    }
    const { data } = await API.get(`/branches/${branchId}/commissions`);
    return (data.data ?? data) as Commission[];
  };
  const { data: formCommissions } = useQuery<Commission[]>({
    queryKey: ['branch-commissions', formData.branch_id, canViewCommissions],
    queryFn: () => loadCommissions(formData.branch_id),
    enabled: !!formData.branch_id,
    staleTime: 1000 * 60 * 10,
  });

  const formPaymentMethods = useMemo(
    () => Array.from(new Set((formCommissions ?? []).map((c) => c.payment_method))),
    [formCommissions],
  );

  const allBranchCommissionsQueries = useQueries({
    queries: (branchesData ?? []).map((b) => ({
      queryKey: ['branch-commissions', String(b.id), canViewCommissions],
      queryFn: () => loadCommissions(b.id),
      staleTime: 1000 * 60 * 10,
    })),
  });

  const allPaymentMethods = useMemo(() => {
    const set = new Set<string>();
    allBranchCommissionsQueries.forEach((q) => {
      q.data?.forEach((c) => set.add(c.payment_method));
    });
    return Array.from(set);
  }, [allBranchCommissionsQueries]);

  const paymentMethodLabel = (method: string) => {
    const normalized = method?.toLowerCase();
    return KNOWN_PAYMENT_METHODS.includes(normalized)
      ? t(`commissions.methods.${normalized}`)
      : method;
  };

  const createMutation = useMutation({
    mutationFn: async (payload: PaymentPayload) => {
      const { data } = await API.post('/payments', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      closeModal();
    },
    // Backend oylik narxdan oshiq to'lovni 422 bilan rad etsa — oylik panel yangi qoldiq bilan qayta yuklanadi
    onError: () => queryClient.invalidateQueries({ queryKey: ['payments', 'preschool-months'] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: PaymentPayload }) => {
      const { data } = await API.put(`/payments/${id}`, updates);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      closeModal();
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['payments', 'preschool-months'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });

  const toDatetimeLocal = (iso: string) => {
    if (!iso) return '';
    return iso
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')
      .slice(0, 16)
      .replace(' ', 'T');
  };

  const toPayloadDatetime = (local: string) => {
    if (!local) return '';
    return local.replace('T', ' ') + ':00';
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingPayment(null);
    setFormData({
      student_id: '',
      student_code: '',
      amount: '',
      payment_type: '',
      course_id: '',
      teacher_id: '',
      cashier_id: '',
      branch_id: '',
      payment_date: '',
      payment_period: '',
      group_id: '',
      created_at: '',
      updated_at: '',
    });
  };

  const openEditModal = (payment: Payment) => {
    setEditingPayment(payment);
    setFormData({
      student_id: payment.student_id?.toString() || '',
      student_code: payment.student?.student_code || '',
      amount: payment.amount?.toString() || '',
      payment_type: payment.payment_method || '',
      course_id: payment.course_id?.toString() || '',
      teacher_id: payment.teacher?.id?.toString() || '',
      cashier_id: payment.user_id?.toString() || '',
      branch_id: payment.branch_id?.toString() || '',
      // Tahrirlashda to'lov sanasi `payment_date`dan olinadi (ilgari `created_at`dan olinardi: har tahrirda
      // orqa sana bilan kiritilgan to'lov sanasi yaratilgan sanaga almashib qolardi).
      payment_date: String(payment.payment_date || payment.created_at || '').slice(0, 10),
      payment_period: normalizePaymentPeriod(payment.payment_period) ?? '',
      group_id: payment.group_id?.toString() || '',
      created_at: toDatetimeLocal(payment.created_at || ''),
      updated_at: toDatetimeLocal(payment.updated_at || ''),
    });
    setShowAddModal(true);
  };

  const handleFormSubmit = () => {
    if (!formData.student_id) {
      notifyWarning(t('payments.studentRequiredAlert', 'O‘quvchi tanlanishi shart!'));
      return;
    }

    if (!formData.amount || !formData.payment_type) {
      notifyWarning(t('payments.allFieldsRequiredAlert', 'Barcha to‘lov maydonlarini to‘ldiring!'));
      return;
    }

    if ((!isPreschoolPayment && !effectiveCourseId) || !formData.branch_id || !formData.cashier_id) {
      notifyWarning(
        t('payments.courseBranchCashierRequiredAlert', 'Kurs, Filial va Kassir tanlanishi shart!'),
      );
      return;
    }

    // Oylik narxdan oshiq (yoki to'liq to'langan oyga) to'lov qabul qilinmaydi.
    if (isPreschoolPayment && (monthFullyPaid || overLimit)) {
      notifyWarning(
        monthFullyPaid
          ? t('payments.monthFullyPaid')
          : t('payments.overLimit', { sum: formatSum(monthLimit) }),
      );
      return;
    }

    const selectedCourse = coursesData?.find((c) => c.id === Number(effectiveCourseId));
    const selectedTeacher = employeesData?.find((e) => e.id === Number(effectiveTeacherId));
    const selectedGroup = groupOptions.find((g) => g.id === Number(formData.group_id));

    const payload: PaymentPayload = {
      full_name: selectedStudent?.label || editingPayment?.student?.full_name || '',
      amount: Number(formData.amount),
      payment_method: formData.payment_type,
      course: selectedCourse?.label ?? '',
      group: selectedGroup?.label ?? '',
      teacher: selectedTeacher?.label ?? '',
      course_id: effectiveCourseId ? Number(effectiveCourseId) : undefined,
      branch_id: Number(formData.branch_id),
      user_id: Number(formData.cashier_id),
      teacher_id: effectiveTeacherId ? Number(effectiveTeacherId) : undefined,
      group_id: formData.group_id ? Number(formData.group_id) : undefined,
      student_id: Number(formData.student_id),
      payment_date: formData.payment_date || toTashkentDate(new Date()),
      // `YYYY-MM`: maktabga tayyorlov filialda tanlangan oy (bo'sh bo'lsa to'lov sanasi oyi); yangi oddiy to'lovda ham
      // sana oyi yuboriladi, mavjud oddiy to'lovning davri tahrirda o'zgartirilmaydi.
      ...((isPreschoolPayment || !editingPayment) && {
        payment_period: isPreschoolPayment
          ? formPeriod
          : formData.payment_period ||
            periodOfDate(formData.payment_date || toTashkentDate(new Date())),
      }),
      ...(editingPayment && {
        ...(formData.created_at && { created_at: toPayloadDatetime(formData.created_at) }),
        ...(formData.updated_at && { updated_at: toPayloadDatetime(formData.updated_at) }),
      }),
    };

    if (editingPayment) {
      updateMutation.mutate({ id: editingPayment.id, updates: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const filtered = useMemo(() => {
    const payments = allPayments || [];

    return payments
      .filter((u) => {
        const searchValue = search.trim().toLowerCase();

        const fullName =
          `${u.student?.last_name ?? ''} ${u.student?.first_name ?? ''}`.toLowerCase();

        const id = String(u.id);

        const matchSearch = fullName.includes(searchValue) || id.includes(searchValue);

        const matchPaymentType = paymentTypeFilter
          ? u.payment_method?.toLowerCase() === paymentTypeFilter.toLowerCase()
          : true;

        const matchBranch = branchFilter ? String(u.branch_id) === branchFilter : true;

        return matchSearch && matchPaymentType && matchBranch;
      })
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [allPayments, search, paymentTypeFilter, branchFilter, sortAsc]);

  const paymentsTotal = filtered.length;
  const paymentsTotalPages = Math.max(1, Math.ceil(paymentsTotal / pageSize));
  const safePage = Math.min(page, paymentsTotalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const toggleAll = (checked: boolean) => setSelected(checked ? pageRows.map((u) => u.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    } else if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const formatAmount = (amount: string | number) => {
    return Number(amount)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });

  const { ref: tableWrapRef, onMouseDown: onTableWrapMouseDown } = useDragScroll<HTMLDivElement>();

  const renderCell = (u: Payment, colId: string) => {
    switch (colId) {
      case 'full_name':
        return `${u.student?.last_name ?? ''} ${u.student?.first_name ?? ''}`.trim() || '-';
      case 'amount':
        return formatAmount(u.amount);
      case 'payment_method':
        return paymentMethodLabel(u.payment_method);
      case 'commission_percent': {
        const pct = u.commission_percent ?? u.commission_log?.commission_percent;
        return pct != null && pct !== '' ? `${Number(pct)}%` : '-';
      }
      case 'commission_amount': {
        const c = u.commission_amount ?? u.commission_log?.commission_amount;
        return c != null && c !== '' ? formatAmount(c) : '-';
      }
      case 'final_amount': {
        const f = u.final_amount ?? u.commission_log?.final_amount;
        return f != null && f !== '' ? formatAmount(f) : formatAmount(u.amount);
      }
      case 'payment_date':
        // `2026-09-18` → `18.09.2026` (boshqa jadvallar bilan bir xil ko'rinish)
        return formatDate(u.payment_date, '-');
      case 'course':
        return u.course ? getLocalized(u.course, 'name', i18n.language) : '-';
      case 'cashier':
        return u.cashier?.full_name || '-';
      case 'branch':
        return u.branch
          ? getLocalized(u.branch, 'name', i18n.language) || u.branch.name_uz || '-'
          : '-';
      default:
        return '-';
    }
  };

  return (
    <section className="payments container">
      <h1 className="main-title">{t('payments.mainTitle')}</h1>
      <AccessNotice kind="branch" />

      {showAddModal && (
        <div className="modal-overlay">
          <div
            className={`modal add-payment-modal large${
              editingPayment ? ' payment-modal-edit' : ''
            }`}
          >
            <h3 className="modal-title">
              {editingPayment ? t('payments.editPaymentTitle') : t('payments.addNewPaymentTitle')}
            </h3>

            <div className="add-payment-form two-column">
              <div className="form-left">
                <div className="form-group">
                  <label className="payment-label-row">
                    <span>{t('payments.accountNumber')}</span>
                    <span className="payment-optional">{t('payments.optional')}</span>
                  </label>
                  <input
                    value={formData.student_code}
                    onChange={(e) => handleAccountNumberChange(e.target.value)}
                    placeholder={t('payments.accountNumber')}
                    autoComplete="off"
                    className={accountMissing ? 'payments-amount-invalid' : undefined}
                  />
                  {accountMissing && (
                    <span className="payment-account-missing" role="alert">
                      {t('payments.accountMissing')}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label>{t('payments.student')}</label>
                  <select
                    value={formData.student_id}
                    onChange={(e) => {
                      const student = studentsData?.find((s) => String(s.id) === e.target.value);
                      if (student) {
                        applyStudentSelection(student);
                      } else {
                        setFormData({ ...formData, student_id: '', student_code: '' });
                      }
                    }}
                  >
                    <option value="">{t('payments.choose')}</option>
                    {studentsData?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                {!isPreschoolPayment && (
                <div className="form-group">
                  <label>{t('payments.course')}</label>
                  <select
                    value={effectiveCourseId}
                    onChange={(e) => setFormData({ ...formData, course_id: e.target.value })}
                    disabled={!editingPayment && !formData.student_id}
                  >
                    <option value="">
                      {!editingPayment && !formData.student_id
                        ? t('payments.chooseStudentFirst')
                        : t('payments.choose')}
                    </option>
                    {modalCourseOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                )}

                <div className="form-group">
                  <label>{t('payments.group')}</label>
                  <select
                    value={formData.group_id}
                    onChange={(e) => {
                      const groupId = e.target.value;
                      const group = groupOptions.find((g) => String(g.id) === groupId);
                      setFormData({
                        ...formData,
                        group_id: groupId,
                        course_id: group?.course_id ? String(group.course_id) : formData.course_id,
                        teacher_id: group?.teacher_id
                          ? String(group.teacher_id)
                          : formData.teacher_id,
                        // Guruh almashsa oy qayta taklif qilinadi (tahrirlashda mavjud to'lov oyi saqlanadi)
                        payment_period: editingPayment ? formData.payment_period : '',
                      });
                    }}
                    disabled={!editingPayment && !formData.student_id}
                  >
                    <option value="">
                      {!editingPayment && !formData.student_id
                        ? t('payments.chooseStudentFirst')
                        : t('payments.choose')}
                    </option>
                    {modalGroupOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('payments.teacher')}</label>
                  <select
                    value={effectiveTeacherId}
                    onChange={(e) => setFormData({ ...formData, teacher_id: e.target.value })}
                  >
                    <option value="">{t('payments.choose')}</option>
                    {employeesData?.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-right">
                <div className="form-group">
                  <label>{t('payments.branch')}</label>
                  <select
                    value={formData.branch_id}
                    onChange={(e) =>
                      setFormData({ ...formData, branch_id: e.target.value, payment_type: '' })
                    }
                  >
                    <option value="">{t('payments.choose')}</option>
                    {branchesData?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('payments.amount')}</label>
                  <input
                    id="payment-amount"
                    className={overLimit ? 'payments-amount-invalid' : undefined}
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  />
                  {isPreschoolPayment && monthLimit !== null && monthLimit > 0 && (
                    <div className="payments-amount-hint">
                      <span>{t('payments.maxAmount', { sum: formatSum(monthLimit) })}</span>
                      <button
                        type="button"
                        className="payments-amount-fill"
                        onClick={() => setFormData({ ...formData, amount: String(monthLimit) })}
                      >
                        {t('payments.payRemaining')}
                      </button>
                    </div>
                  )}
                  {isPreschoolPayment && overLimit && (
                    <span className="payments-amount-error" role="alert">
                      {monthFullyPaid
                        ? t('payments.monthFullyPaid')
                        : t('payments.overLimit', { sum: formatSum(monthLimit) })}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label>{t('payments.paymentMethod')}</label>
                  <select
                    value={formData.payment_type}
                    onChange={(e) => setFormData({ ...formData, payment_type: e.target.value })}
                    disabled={!formData.branch_id}
                  >
                    <option value="">
                      {formData.branch_id ? t('payments.choose') : t('payments.chooseBranchFirst')}
                    </option>
                    {formPaymentMethods.map((method) => (
                      <option key={method} value={method}>
                        {paymentMethodLabel(method)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('payments.cashier')}</label>
                  <select
                    value={formData.cashier_id}
                    onChange={(e) => setFormData({ ...formData, cashier_id: e.target.value })}
                  >
                    <option value="">{t('payments.choose')}</option>
                    {usersData?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('payments.paymentDate')}</label>
                  <input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                  />
                </div>

                {isPreschoolPayment && (
                  <div className="form-group">
                    <label>{t('payments.paymentPeriod')}</label>
                    {monthsData && monthsData.months.length > 0 ? (
                      <select
                        id="payment-period"
                        value={formPeriod}
                        onChange={(e) => setFormData({ ...formData, payment_period: e.target.value })}
                      >
                        {/* Tahrirlanayotgan to'lovning oyi ro'yxatda bo'lmasa ham tanlov bo'sh qolmasin */}
                        {!monthRow && <option value={formPeriod}>{periodLabel(formPeriod, t)}</option>}
                        {monthsData.months.map((m) => (
                          <option key={m.period} value={m.period}>
                            {m.debt === null
                              ? t('payments.optionNoPrice', { month: periodLabel(m.period, t) })
                              : m.debt === 0
                                ? t('payments.optionPaid', { month: periodLabel(m.period, t) })
                                : t(m.advance ? 'payments.optionAdvance' : 'payments.optionDebt', {
                                    month: periodLabel(m.period, t),
                                    sum: formatSum(m.debt),
                                  })}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="payment-period"
                        type="month"
                        value={formPeriod}
                        onChange={(e) => setFormData({ ...formData, payment_period: e.target.value })}
                      />
                    )}
                    <span style={{ marginTop: '3px' }}>
                      <InfoHint
                        withLabel
                        text={monthsData ? t('payments.periodHintMonthly') : t('payments.paymentPeriodHint')}
                      />
                    </span>
                  </div>
                )}

                {/* Maktabga tayyorlov: tanlangan oy va jami qarz (balans yo'q) */}
                {isPreschoolPayment && monthsQuery.isLoading && (
                  <div className="payments-month-panel payments-month-panel--muted">
                    {t('payments.monthsLoading')}
                  </div>
                )}
                {isPreschoolPayment && monthsData && (
                  <div className="payments-month-panel">
                    {monthRow && (
                      <>
                        <div className="payments-month-row">
                          <span className="payments-month-label">{t('payments.monthlyPrice')}</span>
                          <span className="payments-month-value">
                            {monthRow.expected !== null
                              ? `${formatSum(monthRow.expected)} ${t('payments.currencyShort')}`
                              : '—'}
                          </span>
                        </div>
                        <div className="payments-month-row">
                          <span className="payments-month-label">{t('payments.monthPaid')}</span>
                          <span className="payments-month-value">
                            {formatSum(monthRow.paid)} {t('payments.currencyShort')}
                          </span>
                        </div>
                        {monthRow.debt !== null && (
                          <div className="payments-month-row">
                            <span className="payments-month-label">{t('payments.monthRemaining')}</span>
                            <span
                              className={`payments-month-value ${monthRow.debt > 0 ? 'is-red' : 'is-green'}`}
                            >
                              {formatSum(monthRow.debt)} {t('payments.currencyShort')}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    <div className="payments-month-row payments-month-row--total">
                      <span className="payments-month-label">{t('payments.totalDebt')}</span>
                      {monthsData.totalDebt > 0 ? (
                        <span className="payments-month-value is-red">
                          {formatSum(monthsData.totalDebt)} {t('payments.currencyShort')} (
                          {t('payments.debtMonths', { count: monthsData.debtMonths })})
                        </span>
                      ) : (
                        <span className="payments-month-value is-green">{t('payments.noDebt')}</span>
                      )}
                    </div>
                    {monthFullyPaid && !overLimit && (
                      <div className="payments-month-note payments-month-note--ok">
                        {t('payments.monthFullyPaid')}
                      </div>
                    )}
                    {monthRow && monthRow.expected === null && (
                      <div className="payments-month-note">{t('payments.noMonthPrice')}</div>
                    )}
                  </div>
                )}

                {editingPayment && (
                  <div className="form-datetime-row">
                    <div className="form-group">
                      <label>{t('payments.createdAt', 'Yaratilgan vaqt')}</label>
                      <input
                        type="datetime-local"
                        value={formData.created_at}
                        onChange={(e) => setFormData({ ...formData, created_at: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label>{t('payments.updatedAt', 'O‘zgartirilgan vaqt')}</label>
                      <input
                        type="datetime-local"
                        value={formData.updated_at}
                        onChange={(e) => setFormData({ ...formData, updated_at: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions center">
              <button
                className="primary"
                onClick={handleFormSubmit}
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  (isPreschoolPayment && (overLimit || monthFullyPaid))
                }
              >
                {createMutation.isPending || updateMutation.isPending
                  ? t('users.saving')
                  : t('payments.save')}
              </button>
              <button className="cancel" onClick={closeModal}>
                {t('payments.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.payment')}
          fields={[
            { label: t('columns.full_name'), value: renderCell(viewItem, 'full_name') },
            { label: t('columns.branch'), value: renderCell(viewItem, 'branch') },
            { label: t('columns.course'), value: renderCell(viewItem, 'course') },
            { label: t('columns.amount'), value: renderCell(viewItem, 'amount') },
            { label: t('columns.payment_method'), value: renderCell(viewItem, 'payment_method') },
            { label: t('columns.commission_percent'), value: renderCell(viewItem, 'commission_percent') },
            { label: t('columns.commission_amount'), value: renderCell(viewItem, 'commission_amount') },
            { label: t('columns.final_amount'), value: renderCell(viewItem, 'final_amount') },
            { label: t('columns.payment_date'), value: renderCell(viewItem, 'payment_date') },
            { label: t('columns.cashier'), value: renderCell(viewItem, 'cashier') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('payments.confirmDelete')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('payments.confirm')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('payments.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="payments-filters">
        <Protected permission="payments.create">
          <button className="add-new-payment" onClick={() => setShowAddModal(true)}>
            {t('payments.addPayment')}
          </button>
        </Protected>
        <Protected permission="payments.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('payments.delete')}
          </button>
        </Protected>
        <select
          className="payment-type-select"
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('payments.branch')}</option>
          {branchesData?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          className="payment-type-select"
          value={paymentTypeFilter}
          onChange={(e) => {
            setPaymentTypeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('payments.paymentMethod')}</option>
          {allPaymentMethods.map((method) => (
            <option key={method} value={method}>
              {paymentMethodLabel(method)}
            </option>
          ))}
        </select>

        <div className="search-box">
          <input
            placeholder={t('payments.search')}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <i className="fa-solid fa-magnifying-glass"></i>
        </div>
      </div>

      <div
        className="payments-table-wrapper drag-scroll"
        ref={tableWrapRef}
        onMouseDown={onTableWrapMouseDown}
      >
        <table className="payments-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === pageRows.length && pageRows.length > 0}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              {isVisible('id') && (
                <th className="th-sortable" onClick={() => setSortAsc((p) => !p)}>
                  ID {sortAsc ? '↑' : '↓'}
                </th>
              )}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t('payments.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={10} columnCount={colCount} />
            ) : pageRows.length > 0 ? (
              pageRows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(u.id)}
                      onChange={() => toggleOne(u.id)}
                    />
                  </td>

                  {isVisible('id') && <td>{u.id}</td>}
                  {visibleColumns.map((colId) => (
                    <td key={colId}>{renderCell(u, colId)}</td>
                  ))}
                  <td className="actions">
                    <Protected permission="payments.show">
                      <button
                        type="button"
                        className="payment-view-btn"
                        title={t('viewModal.view')}
                        aria-label={t('viewModal.view')}
                        onClick={() => setViewItem(u)}
                      >
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="payments.edit">
                      <button className="payment-edit-btn" onClick={() => openEditModal(u)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>
                    <Protected permission="payments.delete">
                      <button
                        className="payment-delete-btn"
                        onClick={() => {
                          setDeleteTarget(u.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('payments.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={safePage}
        totalPages={paymentsTotalPages}
        total={paymentsTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
};

export default Payments;
