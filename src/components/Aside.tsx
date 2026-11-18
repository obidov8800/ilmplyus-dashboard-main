interface NavChild {
  label: string;
  path: string;
  permission?: string;
  /**
   * Qo'shimcha shart — sozlamalardagi imkoniyat belgisi (`/dashboard-settings` → `features`). IP-telefoniya sahifasi
   * `ip_telephone.view` belgisi o'chiq bo'lsa o'zi bosh sahifaga qaytaradi: menyuda havola qolsa — «o'lik» bo'lardi.
   */
  feature?: string;
  isNested?: boolean;
}

/** Menyu bandi (va bosh sahifa yo'naltirgichi) uchun yagona ko'rinish sharti. */
export const canSeeNavChild = (child: NavChild, hasPermission: (permission?: string) => boolean): boolean =>
  hasPermission(child.permission) && (!child.feature || hasPermission(child.feature));

interface NavGroup {
  id: string;
  label: string;
  faIcon?: string;
  imgIcon?: string;
  paths: string[];
  children: NavChild[];
}

interface Props {
  collapsed: boolean;
  onOpen: () => void;
  onClose: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

import { useState } from 'react';
import asideLogo from '../assets/images/talim tizimi white.svg';
import mainLogo from '../assets/images/logo-mini.svg';
import expenseIcon from '../assets/images/walletIcon.svg';
import studentsIcon from '../assets/images/aside-students.svg';
import paymentsIcon from '../assets/images/money-bill.svg';
import userIcon from '../assets/images/aside-users.svg';
import employeeIcon from '../assets/images/briefcase-solid-full.svg';
import organizationIcon from '../assets/images/school-solid-full.svg';
import coursesIcon from '../assets/images/aside-school.svg';
// import salariesIcon from '../assets/images/money-check-dollar-solid-full.svg';
import salesDepartmentIcon from '../assets/images/chart-line-solid-full.svg';
import tasksIcon from '../assets/images/list-check-solid-full.svg';
import testIcon from '../assets/images/clipboard-check-solid-full.svg';
import trashIcon from '../assets/images/trash-solid-full.svg';
import settingsIcon from '../assets/images/aside-settings.svg';
import financesIcon from '../assets/images/building-columns-solid-full.svg';
import loginHistoryIcon from '../assets/images/shield-halved-solid.svg';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import useAuthStore from '../store/useAuthStore';
import { useQuery } from '@tanstack/react-query';
import { useNavAccess } from '../hooks/useNavAccess';
import { API } from '../api/api';

/**
 * Yon panel tuzilmasi — `Aside` (menyu) va `HomeRedirect` (kirgach birinchi ochiq sahifaga yo'naltirish)
 * uchun YAGONA manba: menyuga yangi band qo'shsangiz, bosh sahifa yo'naltirgichi ham uni avtomatik biladi.
 */
export const buildNavGroups = (t: TFunction): NavGroup[] => [
  {
    id: 'users-group',
    label: t('aside.users'),
    imgIcon: userIcon,
    paths: ['/users', '/roles', '/operators'],
    children: [
      { label: t('aside.users'), path: '/users', permission: 'users.view' },
      { label: t('aside.roles'), path: '/roles', permission: 'roles.view' },
      { label: t('aside.operators'), path: '/operators', permission: 'ip_telefon_operators.view' },
    ],
  },
  {
    id: 'org-group',
    label: t('aside.organization'),
    imgIcon: organizationIcon,
    paths: ['/branches', '/areas', '/department', '/rooms', '/face-id'],
    children: [
      { label: t('aside.branches'), path: '/branches', permission: 'branches.view' },
      { label: t('aside.areas'), path: '/areas', permission: 'regions.view', isNested: true },
      { label: t('aside.departments'), path: '/department', permission: 'departments.view' },
      { label: t('aside.rooms'), path: '/rooms', permission: 'rooms.view' },
      { label: t('aside.faceId'), path: '/face-id', permission: 'hikvision_devices.view' },
    ],
  },
  {
    id: 'staff-group',
    label: t('aside.staffDepartment'),
    imgIcon: employeeIcon,
    paths: ['/employees', '/attendance', '/positions', '/contracts', '/teachers'],
    children: [
      { label: t('aside.employees'), path: '/employees', permission: 'employees.view' },
      { label: t('aside.staffAttendance'), path: '/attendance', permission: 'attendance.view' },
      { label: t('aside.positions'), path: '/positions', permission: 'positions.view' },
      { label: t('aside.contract'), path: '/contracts', permission: 'employee_contracts.view' },
      { label: t('aside.teachers'), path: '/teachers', permission: 'employee_contracts.view' },
    ],
  },
  {
    id: 'courses-group',
    label: t('aside.courses'),
    imgIcon: coursesIcon,
    paths: [
      '/courses',
      '/levels',
      '/course-prices',
      '/lesson-schedule',
      '/demo-lesson',
      '/groups',
      '/academic-years',
      '/preschool-prices',
    ],
    children: [
      { label: t('aside.courses'), path: '/courses', permission: 'courses.view' },
      { label: t('aside.levels'), path: '/levels', permission: 'levels.view' },
      {
        label: t('aside.coursePrices'),
        path: '/course-prices',
        permission: 'course_prices.view',
      },
      {
        label: t('aside.lessonSchedule'),
        path: '/lesson-schedule',
        permission: 'lessons_schedules.view',
      },
      { label: t('aside.demoLesson'), path: '/demo-lesson', permission: 'demo_lessons.view' },
      // «Guruhlar» — `groups.view` (App.tsx dagi marshrut bilan bir xil).
      { label: t('aside.groups'), path: '/groups', permission: 'groups.view' },
      {
        label: t('aside.academicYears'),
        path: '/academic-years',
        permission: 'academic_years.view',
      },
      {
        label: t('aside.preschoolPrices'),
        path: '/preschool-prices',
        permission: 'preschool_prices.view',
      },
    ],
  },
  {
    id: 'sales-group',
    label: t('aside.salesDepartment'),
    imgIcon: salesDepartmentIcon,
    paths: ['/lid', '/ip-telephone', '/refusal-reasons', '/sources'],
    children: [
      { label: t('aside.lidList'), path: '/lid', permission: 'lids.view' },
      {
        label: t('aside.ipTelephone'),
        path: '/ip-telephone',
        permission: 'ip_telefon_operators.view',
        feature: 'ip_telephone.view',
      },
      {
        label: t('aside.refusalReasons'),
        path: '/refusal-reasons',
        permission: 'rejection_reasons.view',
      },
      { label: t('aside.sources'), path: '/sources', permission: 'sources.view' },
    ],
  },
  {
    // Vazifalar — alohida bo'lim: operator vazifalari + yillik siklogramma.
    id: 'tasks-group',
    label: t('aside.tasks'),
    imgIcon: tasksIcon,
    paths: ['/tasks', '/cyclogram'],
    children: [
      { label: t('aside.operatorTasks'), path: '/tasks', permission: 'tasks.view' },
      // Backendda siklogramma uchun alohida ruxsat yo'q — `tasks.view` bilan ochiladi.
      { label: t('aside.cyclogram'), path: '/cyclogram', permission: 'tasks.view' },
    ],
  },
  {
    id: 'test-group',
    label: t('aside.test'),
    imgIcon: testIcon,
    paths: ['/questions'],
    children: [{ label: t('aside.questions'), path: '/questions', permission: 'questions.view' }],
  },
  {
    id: 'expenses-group',
    label: t('aside.expenses'),
    imgIcon: expenseIcon,
    paths: ['/expenses'],
    children: [
      {
        label: t('aside.expenseCategory'),
        path: '/expenses/category',
        permission: 'expense_categories.view',
      },
      {
        label: t('aside.expenseSubCategory'),
        path: '/expenses/subcategory',
        permission: 'expense_subcategories.view',
      },
      { label: t('aside.expenseCreate'), path: '/expenses/create', permission: 'expenses.view' },
    ],
  },
  {
    id: 'finances-group',
    label: t('aside.finances'),
    imgIcon: financesIcon,
    paths: [
      '/finances',
      '/daily-cash-reports',
      '/jamgarma',
      '/jamgarma-names',
      '/debts',
      '/fine-types',
      '/finance-generation',
      '/advance-schedule',
      '/salary-schedule',
      '/payroll-adjustments',
      '/payroll-distribution-requests',
      // Xodim shartnomasidan ochiladigan "Oylik taqsimoti" sahifasi
      // (`/payroll/distributions/:employeeId`) — menyuda alohida havola
      // sifatida ko'rinmaydi, lekin shu bo'limga tegishli, shuning uchun
      // ochilganda "Moliya" bo'limi aktiv/ochiq bo'lib turishi kerak.
      '/payroll/distributions',
    ],
    children: [
      {
        label: t('aside.scoreSheet'),
        path: '/finances',
        permission: 'chart_of_accounts.view',
      },
      {
        label: t('aside.dailyCashReports'),
        path: '/daily-cash-reports',
        permission: 'daily_cash_reports.view',
      },
      {
        label: t('aside.jamgarma'),
        path: '/jamgarma',
        permission: 'jamgarmas.view',
      },
      {
        label: t('aside.jamgarmaNames'),
        path: '/jamgarma-names',
        permission: 'jamgarma_names.view',
      },
      {
        label: t('aside.debts'),
        path: '/debts',
        permission: 'jamgarma_loans.view',
      },
      {
        label: t('aside.fineTypes'),
        path: '/fine-types',
        permission: 'fine_types.view',
      },
      {
        label: t('aside.generation'),
        path: '/finance-generation',
        permission: 'payroll_sheets.view',
      },
      {
        label: t('aside.advanceSchedule'),
        path: '/advance-schedule',
        permission: 'payroll_sheets.view',
      },
      {
        label: t('aside.salarySchedule'),
        path: '/salary-schedule',
        permission: 'payroll_sheets.view',
      },
      {
        label: t('aside.payrollAdjustments'),
        path: '/payroll-adjustments',
        permission: 'payroll_adjustments.view',
      },
      {
        label: t('aside.payrollDistributionRequests'),
        path: '/payroll-distribution-requests',
        permission: 'payroll_distributions.view',
      },
    ],
  },
  {
    id: 'students-group',
    label: t('aside.students'),
    imgIcon: studentsIcon,
    paths: [
      '/students-attendance',
      '/preschool-attendance',
      '/student-tasks',
      '/students-contract',
      '/preschool-contracts',
      '/students',
    ],
    children: [
      {
        label: t('aside.studentsAttendance'),
        path: '/students-attendance',
        permission: 'student_attendance.view',
      },
      {
        label: t('aside.preschoolAttendance'),
        path: '/preschool-attendance',
        permission: 'preschool_attendances.view',
      },
      {
        label: t('aside.studentTasks'),
        path: '/student-tasks',
        permission: 'homework_submissions.view',
      },
      {
        label: t('aside.studentsContract'),
        path: '/students-contract',
        permission: 'student_contracts.view',
      },
      {
        label: t('aside.preschoolContracts'),
        path: '/preschool-contracts',
        permission: 'preschool_contracts.view',
      },
      { label: t('aside.students'), path: '/students', permission: 'students.view' },
    ],
  },
  {
    id: 'payments-group',
    label: t('aside.payments'),
    imgIcon: paymentsIcon,
    paths: ['/payments', '/commissions'],
    children: [
      { label: t('aside.paymentsList'), path: '/payments', permission: 'payments.view' },
      { label: t('aside.commissions'), path: '/commissions', permission: 'payment_gateway_commissions.view' },
    ],
  },
  // {
  //   id: 'salaries-group',
  //   label: t('aside.salaries'),
  //   imgIcon: salariesIcon,
  //   paths: ['/salaries'],
  //   children: [{ label: t('aside.salary'), path: '/salaries', permission: 'salaries.view' }],
  // },
  {
    id: 'trash-group',
    label: t('aside.trash'),
    imgIcon: trashIcon,
    paths: ['/trash'],
    children: [{ label: t('aside.trash'), path: '/trash', permission: 'trash.view' }],
  },
  {
    id: 'settings-group',
    label: t('aside.settings'),
    imgIcon: settingsIcon,
    paths: ['/settings'],
    children: [
      { label: t('aside.settings'), path: '/settings', permission: 'settings.view' },
    ],
  },
  {
    id: 'login-history-group',
    label: t('aside.loginHistory'),
    imgIcon: loginHistoryIcon,
    paths: ['/login-history'],
    children: [
      {
        label: t('aside.loginHistory'),
        path: '/login-history',
        permission: 'login_histories.view',
      },
    ],
  },
];

const pathMatches = (path: string, current: string) => {
  if (path === '/') return current === '/';
  return current === path || current.startsWith(path + '/');
};

const Aside = ({ collapsed, mobileOpen = false, onOpen, onClose, onMobileClose }: Props) => {
  const { t } = useTranslation();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  const { data: trashUnviewedCount = 0 } = useQuery<number>({
    // Bu yerda natija SON; axlat sahifasida esa obyekt — kalit to'qnashmasin.
    queryKey: ['trash-unviewed-count', 'badge'],
    queryFn: async () => {
      const { data } = await API.get('/trash/unviewed-count', { silentError: true });
      return typeof data === 'number' ? data : (data?.count ?? 0);
    },
    // Axlat belgisi tinmasdan (har daqiqada) so'ralmaydi: sahifa ochilganda, oynaga qaytganda (5 daqiqadan eski bo'lsa)
    // va axlat sahifasida «ko'rildi» belgilanganda yangilanadi.
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });

  // Menyu bandi ruxsati — HomeRedirect bilan bir xil qoida (hooks/useNavAccess.ts).
  const { hasPermission } = useNavAccess();

  const groups = buildNavGroups(t);

  const getInitialOpen = () => {
    const cur = location.pathname;
    const open: Record<string, boolean> = {};
    groups.forEach((g) => {
      if (g.paths.some((p) => pathMatches(p, cur))) open[g.id] = true;
    });
    return open;
  };

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(getInitialOpen);
  const [openAreas, setOpenAreas] = useState(location.pathname.startsWith('/areas'));

  // Bir vaqtda faqat bitta bo'lim ochiq turishi kerak — boshqasini bosganda
  // avvalgisi avtomatik yopiladi (ilgari har biri mustaqil `openMap[id]`
  // bilan boshqarilardi, shu sabab bir nechtasi bir vaqtda ochiq qolib
  // ketishi mumkin edi).
  const toggle = (id: string) => {
    setOpenMap((prev) => (prev[id] ? {} : { [id]: true }));
  };

  const isGroupActive = (paths: string[]) => paths.some((p) => pathMatches(p, location.pathname));

  const isExpanded = !collapsed || mobileOpen;

  const handleNavClick = () => {
    if (mobileOpen && onMobileClose) {
      onMobileClose();
    }
  };

  return (
    <aside
      className={`aside ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <div className="aside-top">
        <img
          src={collapsed && !mobileOpen ? mainLogo : asideLogo}
          alt="logo"
          className={collapsed && !mobileOpen ? 'collapsed-logo' : 'aside-logo'}
        />
        <button
          type="button"
          className="aside-mobile-close"
          onClick={onMobileClose}
          aria-label="Menyuni yopish"
          title="Yopish"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      <div className="aside-content">
        <div className="sidebar">
          {/* Accordion groups */}
          {groups.map((group) => {
            const filteredChildren = group.children.filter((c) => canSeeNavChild(c, hasPermission));
            if (!filteredChildren.length) return null;

            const active = isGroupActive(group.paths);
            const open = !!openMap[group.id];

            return (
              <div key={group.id} className="nav-group">
                {/* Group header */}
                <div
                  className={`nav-group-header ${active ? 'nav-group-active' : ''}`}
                  onClick={() => isExpanded && toggle(group.id)}
                >
                  <span className="sidebar-icon">
                    {group.imgIcon ? (
                      <img src={group.imgIcon} alt={group.label} />
                    ) : (
                      <i className={group.faIcon} />
                    )}
                  </span>
                  {isExpanded && (
                    <>
                      <span className="nav-group-label">{group.label}</span>
                      {group.id === 'trash-group' && trashUnviewedCount > 0 && (
                        <span className="trash-unviewed-badge">{trashUnviewedCount}</span>
                      )}
                      <i
                        className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'} nav-group-chevron`}
                      />
                    </>
                  )}
                </div>

                {/* Sub-items */}
                {open && isExpanded && (
                  <div className="sidebar-submenu">
                    {filteredChildren.map((child) => {
                      if (child.isNested) {
                        const areasActive = location.pathname.startsWith('/areas');
                        return (
                          <div key={child.path}>
                            <div
                              className={`sidebar-subitem sidebar-area-parent ${areasActive ? 'active' : ''}`}
                              onClick={() => setOpenAreas((v) => !v)}
                            >
                              <i className="fa-solid fa-circle dot-icon" />
                              <span className="subitem-label">{t('aside.areas')}</span>
                              <i
                                className={`fa-solid ${openAreas ? 'fa-chevron-up' : 'fa-chevron-down'} area-chevron`}
                              />
                            </div>
                            {openAreas && (
                              <>
                                <NavLink
                                  to="/areas/regions"
                                  onClick={handleNavClick}
                                  className={({ isActive }) =>
                                    `sidebar-subitem sidebar-subitem-nested ${isActive ? 'active' : ''}`
                                  }
                                >
                                  <i className="fa-solid fa-circle dot-icon" />
                                  <span className="subitem-label">{t('aside.regions')}</span>
                                </NavLink>
                                <NavLink
                                  to="/areas/districts"
                                  onClick={handleNavClick}
                                  className={({ isActive }) =>
                                    `sidebar-subitem sidebar-subitem-nested ${isActive ? 'active' : ''}`
                                  }
                                >
                                  <i className="fa-solid fa-circle dot-icon" />
                                  <span className="subitem-label">{t('aside.districts')}</span>
                                </NavLink>
                              </>
                            )}
                          </div>
                        );
                      }

                      return (
                        <NavLink
                          key={child.path}
                          to={child.path}
                          onClick={handleNavClick}
                          className={({ isActive }) =>
                            `sidebar-subitem ${isActive ? 'active' : ''}`
                          }
                        >
                          <i className="fa-solid fa-circle dot-icon" />
                          <span className="subitem-label">{child.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="aside-version">1.5 versiya</div>
    </aside>
  );
};

export default Aside;
