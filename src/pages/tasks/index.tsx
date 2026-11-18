import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import TaskCard from '@/components/TaskCard';
import TaskModal from '@/components/TaskModal';
import './tasks.css';
import { API } from '@/api/api';
import { Protected } from '@/components/Protected';
import { usePermission } from '@/hooks/usePermission';
import useAuthStore from '@/store/useAuthStore';
import PaginationBar from '@/components/Pagination/PaginationBar';
import { normalizePaginated } from '@/utils/normalizePaginated';
import type { Task, TaskStatus } from '@/types/tasks.types';
import { useOptions } from '@/hooks/useOptions';

type FilterStatus = 'barchasi' | TaskStatus;

const FILTER_OPTIONS: { label: string; value: FilterStatus }[] = [
  { label: 'Barchasi', value: 'barchasi' },
  { label: 'Bajarilmoqda', value: 'bajarish' },
  { label: 'Yakunlangan', value: 'bajarildi' },
  { label: 'Bajarilmadi', value: 'bajarilmadi' },
];

export default function Tasks() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [activeFilter, setActiveFilter] = useState<FilterStatus>('barchasi');
  const [operatorFilter, setOperatorFilter] = useState<number | ''>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | undefined>(undefined);

  // Boshqarish (barcha vazifalar, operator filtri, yaratish tugmasi) — rol
  // NOMIga emas, `tasks.create` ruxsatiga qarab. Ilgari rol nomi bo'yicha
  // (`roles[].name.includes('operator')`) edi — backendda rol nomi o'zgarsa
  // yoki boshqa nomdagi rolga shu ruxsat berilsa, sahifa buzilardi.
  const canManage = usePermission('tasks.create');

  const { data: operators = [] } = useOptions('users');
  const effectiveOperatorFilter = canManage ? operatorFilter : (user?.id ?? 0);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const {
    data: tasksRawResponse,
    isLoading,
    isError,
  } = useQuery<unknown, Error>({
    queryKey: ['tasks', page, pageSize],
    queryFn: () => API.get('/tasks', { params: { page, per_page: pageSize } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const {
    items: tasksRaw,
    total: tasksTotal,
    totalPages: tasksTotalPages,
  } = normalizePaginated<Task>(tasksRawResponse, page, pageSize);

  const filteredTasks: Task[] = (tasksRaw ?? []).filter((task) => {
    const statusMatch = activeFilter === 'barchasi' || task.status === activeFilter;
    const operatorMatch =
      effectiveOperatorFilter === '' || task.operator_id === Number(effectiveOperatorFilter);
    return statusMatch && operatorMatch;
  });

  function getShortName(fullName: string) {
    const parts = fullName.split(' ');
    return `${parts[0] ?? ''} ${parts[1] ?? ''}`;
  }

  const handleOpenCreate = () => {
    setEditTask(undefined);
    setModalOpen(true);
  };

  const handleOpenEdit = (task: Task) => {
    setEditTask(task);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditTask(undefined);
  };

  return (
    <div className="tasks container">
      <h1 className="main-title">{t('tasks.taskList')}</h1>
      {canManage && (
        <div className="tasks-top">
          <div className="tasks-top-left">
            <div className="tasks-filters">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`tasks-filter-btn${activeFilter === opt.value ? ' active' : ''}`}
                  onClick={() => {
                    setActiveFilter(opt.value);
                    setPage(1);
                  }}
                >
                  {t(`tasks.filter.${opt.value}`)}
                </button>
              ))}
            </div>

            <select
              className="tasks-operator-select"
              value={operatorFilter}
              onChange={(e) => {
                setOperatorFilter(e.target.value === '' ? '' : Number(e.target.value));
                setPage(1);
              }}
            >
              <option value="">{t('tasks.allOperators')}</option>

              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {getShortName(operator.label)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Protected permission="tasks.create">
              <button className="tasks-create-btn" onClick={handleOpenCreate}>
                ＋ {t('tasks.createTask')}
              </button>
            </Protected>
          </div>
        </div>
      )}

      {!canManage && (
        <div className="tasks-top tasks-top--operator">
          

          <div className="tasks-top-right">
            <div className="tasks-filters">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`tasks-filter-btn${activeFilter === opt.value ? ' active' : ''}`}
                  onClick={() => {
                    setActiveFilter(opt.value);
                    setPage(1);
                  }}
                >
                  {t(`tasks.filter.${opt.value}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading && <div className="tasks-state loading">{t('tasks.loading')}</div>}

      {isError && <div className="tasks-state error">{t('tasks.error')}</div>}

      {!isLoading && !isError && filteredTasks.length === 0 && (
        <div className="tasks-state">{t('tasks.noTasks')}</div>
      )}

      {!isLoading && !isError && filteredTasks.length > 0 && (
        <div className="tasks-content">
          {filteredTasks?.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              canManage={canManage}
              onEdit={handleOpenEdit}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && (
        <PaginationBar
          page={page}
          totalPages={tasksTotalPages}
          total={tasksTotal}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {modalOpen && <TaskModal onClose={handleCloseModal} editTask={editTask} />}
    </div>
  );
}
