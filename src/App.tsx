import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from './store/useAuthStore';
import ProtectedRoute from './components/ProtectedRoute';
import PermissionRoute from './components/PermissionRoute';
import RouteFallback from './components/RouteFallback';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import { usePrefetchRoutes } from './utils/prefetchRoutes';
import useGlobalDragScroll from './hooks/useGlobalDragScroll';
import Layout from './components/Layout';
import HomeRedirect from './components/HomeRedirect';

/*
 * Sahifalar `lazy` bilan yuklanadi (`ilmplyus-main`dagi bilan bir xil sabab
 * va yechim): barchasi to'g'ridan-to'g'ri import qilinganda ilova bitta
 * ~3.8 MB'lik faylga yig'ilardi — brauzer shuning HAMMASINI (jamg'arma,
 * PDF, davomat, shartnoma... hattoki hech qachon ochilmaydigan sahifalar)
 * yuklab, ishga tushirmaguncha birorta API so'rovi ketmasdi, shu "admin
 * sekin ishlayapti" degan shikoyatning asosiy sababi shu edi. Endi har
 * sahifa o'z bo'lagida: ochilish paytida faqat kerakligi yuklanadi.
 * `Layout`, `ProtectedRoute`, `PermissionRoute` — har bir marshrutda,
 * shartsiz kerak bo'lgani uchun (va o'zlari kichik) statik qoldirilgan.
 */
const LoginPage = lazy(() => import('./pages/login'));
const Users = lazy(() => import('./pages/users'));
const UserForm = lazy(() => import('./pages/users/userForm'));
const Settings = lazy(() => import('./pages/settings'));
const Branches = lazy(() => import('./pages/branches'));
const BranchForm = lazy(() => import('./pages/branches/branchForm'));
const Classes = lazy(() => import('./pages/classes'));
const Students = lazy(() => import('./pages/students'));
const Teachers = lazy(() => import('./pages/teachers'));
const Roles = lazy(() => import('./pages/roles'));
const RolePermissions = lazy(() => import('./pages/roles/RolePermissions'));
const CreateRole = lazy(() => import('./pages/roles/CreateRole'));
const Payments = lazy(() => import('./pages/payments'));
const Commissions = lazy(() => import('./pages/commissions'));
const Expenses = lazy(() => import('./pages/expenses'));
const ExpenseCategory = lazy(() => import('./pages/expenses/expenseCategory'));
const ExpenseSubCategory = lazy(() => import('./pages/expenses/expenseSubCategory'));
const Courses = lazy(() => import('./pages/courses'));
const NotFound = lazy(() => import('./pages/notFound'));
const Rooms = lazy(() => import('./pages/rooms'));
const Department = lazy(() => import('./pages/department'));
const Areas = lazy(() => import('./pages/regions'));
const AreaRegions = lazy(() => import('./pages/regions/areaRegions'));
const AreaDistricts = lazy(() => import('./pages/regions/areaDistricts'));
const Levels = lazy(() => import('./pages/levels'));
const Positions = lazy(() => import('./pages/positions'));
const AttendancePage = lazy(() => import('./pages/attendance'));
const AttendanceDetail = lazy(() => import('./pages/attendance/AttendanceDetail'));
const Operators = lazy(() => import('./pages/operators'));
const Sources = lazy(() => import('./pages/sources'));
const RefusalReasons = lazy(() => import('./pages/refusal-reasons'));
const LoginHistory = lazy(() => import('./pages/login-history'));

// New pages
const FaceId = lazy(() => import('./pages/face-id'));
const FaceIdDeviceDetail = lazy(() => import('./pages/face-id/DeviceDetail'));
const Contracts = lazy(() => import('./pages/contracts'));
const ContractsCreate = lazy(() => import('./pages/contracts/ContractsCreate'));
const ContractDetailPage = lazy(() => import('./pages/contracts/ContractDetailPage'));
const CoursePrices = lazy(() => import('./pages/course-prices'));
const CoursePriceDetail = lazy(() => import('./pages/course-prices/CoursePriceDetail'));
const LessonSchedule = lazy(() => import('./pages/lesson-schedule'));
const DemoLesson = lazy(() => import('./pages/demo-lesson'));
const Groups = lazy(() => import('./pages/groups'));
const AcademicYears = lazy(() => import('./pages/academic-years'));
const PreschoolPrices = lazy(() => import('./pages/preschool-prices'));
const PreschoolAttendance = lazy(() => import('./pages/preschool-attendance'));
const PreschoolContracts = lazy(() => import('./pages/preschool-contracts'));
const PreschoolContractCreate = lazy(() => import('./pages/preschool-contracts/PreschoolContractCreate'));
const Lid = lazy(() => import('./pages/lid'));
const IpTelephone = lazy(() => import('./pages/ip-telephone'));
const Tasks = lazy(() => import('./pages/tasks'));
const Cyclogram = lazy(() => import('./pages/cyclogram'));
const Questions = lazy(() => import('./pages/questions'));
const StudentsAttendance = lazy(() => import('./pages/students-attendance'));
const StudentTasks = lazy(() => import('./pages/student-tasks'));
const StudentsContract = lazy(() => import('./pages/students-contract'));
const UnderAge = lazy(() => import('./pages/students-contract/underAge'));
const LegalEntity = lazy(() => import('./pages/students-contract/legalEntity'));
const RepresentativeEntity = lazy(() => import('./pages/students-contract/representativeEntity'));
const ContractDetails = lazy(() => import('./pages/students-contract/ContractDetails'));
const Salaries = lazy(() => import('./pages/salaries'));
const Employees = lazy(() => import('./pages/employees'));
const TrashPage = lazy(() => import('./pages/trash'));
const SetPasswordPage = lazy(() => import('./pages/set-password'));
const Finances = lazy(() => import('./pages/finance'));
const JamgarmaPage = lazy(() => import('./pages/finance/Jamgarma'));
const JamgarmaNamesPage = lazy(() => import('./pages/finance/JamgarmaNames'));
const DailyCashReports = lazy(() => import('./pages/daily-cash-reports'));
const DebtsPage = lazy(() => import('./pages/debts'));
const FineTypes = lazy(() => import('./pages/fine-types'));
const FinanceGeneration = lazy(() => import('./pages/finance-generation'));
const AdvanceSchedule = lazy(() => import('./pages/advance-schedule'));
const SalarySchedule = lazy(() => import('./pages/salary-schedule'));
const PayrollDistribution = lazy(() => import('./pages/payroll-distribution'));
const PayrollAdjustments = lazy(() => import('./pages/payroll-adjustments'));
const AdjustmentForm = lazy(() => import('./pages/payroll-adjustments/AdjustmentForm'));
const PayrollDistributionRequests = lazy(
  () => import('./pages/payroll-distribution-requests'),
);


import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

/*
 * Eski bo'lim «arxiv» sahifalari (`/users/archive`, `/groups/archive` …) olib tashlandi: backend ro'yxat
 * endpointlari `?only_trashed=1` ni qo'llamaydi — u sahifalar o'chirilmagan yozuvlarni «arxiv» deb ko'rsatar,
 * tiklash/butunlay o'chirish tugmalari esa ishlamas edi. Haqiqiy arxiv — «Savat» (`/trash`, `trash.view`).
 * Eski havolalar o'sha sahifaga yo'naltiriladi.
 */
const PAYROLL_DISTRIBUTION_FORM = ['payroll_distributions.view', 'payroll_distributions.create', 'payroll_distributions.edit'];

const LEGACY_ARCHIVE_SECTIONS = [
  'users', 'roles', 'operators', 'branches', 'department', 'rooms', 'positions', 'contracts', 'teachers', 'courses', 'levels', 'course-prices', 'lesson-schedule', 'demo-lesson', 'groups', 'lid', 'ip-telephone', 'refusal-reasons', 'sources', 'tasks', 'questions', 'expenses', 'student-tasks', 'students-contract', 'students', 'payments', 'salaries',
];

const App = () => {
  const isAuth = useAuthStore((state) => state.isAuth);
  const location = useLocation();

  // Gorizontal scroll bo'ladigan istalgan konteynerni (jadval o'ramlari,
  // dars jadvali, doskalar...) sichqoncha bilan ushlab tortib scroll
  // qilish — butun ilova bo'ylab bitta joyda ulanadi.
  useGlobalDragScroll();

  // Ko'p ishlatiladigan sahifalar brauzer bo'sh turganda oldindan yuklanadi —
  // menyudan bosilganda kutish bo'lmaydi.
  usePrefetchRoutes(isAuth);

  // Sessiya muddati tugaganda chiqish. Ilgari bu RENDER ichida edi: har sahifa almashganda yangi taymer qo'shilar va
  // hech biri bekor qilinmasdi — qayta kirilganda ESKI sessiyaning taymeri ham ishlab, foydalanuvchini muddatidan
  // oldin chiqarib yuborishi mumkin edi. Endi bitta taymer, `expiresAt` o'zgarsa yoki chiqilsa — bekor qilinadi.
  const expiresAt = useAuthStore((state) => state.expiresAt);
  useEffect(() => {
    if (!expiresAt) return;
    const { logout } = useAuthStore.getState();
    const timeout = expiresAt - Date.now();
    if (timeout <= 0) {
      logout();
      return;
    }
    // setTimeout 2^31 ms (~24 kun) dan katta qiymatni darhol bajaradi — chegaralab qo'yamiz.
    const timer = window.setTimeout(() => logout(), Math.min(timeout, 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  return (
    <ChunkErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/login" element={isAuth ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          {/* Admin panelda dashboard yo'q: `/` yon paneldagi birinchi ruxsat berilgan sahifaga yo'naltiradi. */}
          <Route path="/" element={<HomeRedirect />} />

          {/* Foydalanuvchilar */}
          <Route element={<PermissionRoute permission="users.view" />}>
            <Route path="/users" element={<Users />} />
          </Route>
          <Route element={<PermissionRoute permission="users.create" />}>
            <Route path="/users/add" element={<UserForm />} />
          </Route>
          <Route element={<PermissionRoute permission="users.edit" />}>
            <Route path="/users/:id/edit" element={<UserForm />} />
          </Route>
          <Route element={<PermissionRoute permission="roles.view" />}>
            <Route path="/roles" element={<Roles />} />
          </Route>
          <Route element={<PermissionRoute permission="roles.create" />}>
            <Route path="/roles/create" element={<CreateRole />} />
          </Route>
          <Route element={<PermissionRoute permission="roles.edit" />}>
            <Route path="/roles/:id/permissions" element={<RolePermissions />} />
          </Route>
          <Route element={<PermissionRoute permission="ip_telefon_operators.view" />}>
            <Route path="/operators" element={<Operators />} />
          </Route>

          {/* Tashkilot */}
          <Route element={<PermissionRoute permission="branches.view" />}>
            <Route path="/branches" element={<Branches />} />
          </Route>
          <Route element={<PermissionRoute permission="branches.create" />}>
            <Route path="/branches/add" element={<BranchForm />} />
          </Route>
          <Route element={<PermissionRoute permission="branches.edit" />}>
            <Route path="/branches/:id/edit" element={<BranchForm />} />
          </Route>
          <Route element={<PermissionRoute permission="regions.view" />}>
            <Route path="/areas" element={<Areas />} />
            <Route path="/areas/regions" element={<AreaRegions />} />
            <Route path="/areas/districts" element={<AreaDistricts />} />
          </Route>
          <Route element={<PermissionRoute permission="departments.view" />}>
            <Route path="/department" element={<Department />} />
          </Route>
          <Route element={<PermissionRoute permission="rooms.view" />}>
            <Route path="/rooms" element={<Rooms />} />
          </Route>
          <Route element={<PermissionRoute permission="hikvision_devices.view" />}>
            <Route path="/face-id" element={<FaceId />} />
            <Route path="/face-id/:id" element={<FaceIdDeviceDetail />} />
          </Route>

          {/* Xodimlar bo'limi */}
          <Route element={<PermissionRoute permission="attendance.view" />}>
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/attendance/:employeeId" element={<AttendanceDetail />} />
          </Route>
          <Route element={<PermissionRoute permission="positions.view" />}>
            <Route path="/positions" element={<Positions />} />
          </Route>
          <Route element={<PermissionRoute permission="employee_contracts.view" />}>
            <Route path="/contracts" element={<Contracts />} />
          </Route>
          <Route element={<PermissionRoute permission="employee_contracts.show" />}>
            <Route path="/contracts/:id" element={<ContractDetailPage />} />
          </Route>
          <Route element={<PermissionRoute permission="employee_contracts.create" />}>
            <Route path="/contracts/create" element={<ContractsCreate />} />
          </Route>
          <Route element={<PermissionRoute permission="employee_contracts.view" />}>
            <Route path="/teachers" element={<Teachers />} />
          </Route>

          {/* Kurslar */}
          <Route element={<PermissionRoute permission="courses.view" />}>
            <Route path="/courses" element={<Courses />} />
          </Route>
          <Route element={<PermissionRoute permission="levels.view" />}>
            <Route path="/levels" element={<Levels />} />
          </Route>
          <Route element={<PermissionRoute permission="course_prices.view" />}>
            <Route path="/course-prices" element={<CoursePrices />} />
          </Route>
          <Route element={<PermissionRoute permission="course_prices.show" />}>
            <Route path="/course-prices/:id" element={<CoursePriceDetail />} />
          </Route>
          <Route element={<PermissionRoute permission="lessons_schedules.view" />}>
            <Route path="/lesson-schedule" element={<LessonSchedule />} />
          </Route>
          <Route element={<PermissionRoute permission="demo_lessons.view" />}>
            <Route path="/demo-lesson" element={<DemoLesson />} />
          </Route>
          {/* «Guruhlar» — bir sahifa, bir ruxsat: `groups.view` (menyu va marshrut bir xil; User ilovasi bilan ham).
              Boshqa sahifalar guruh ro'yxatini `groups.view` siz `/options/groups` dan oladi. */}
          <Route element={<PermissionRoute permission="groups.view" />}>
            <Route path="/groups" element={<Groups />} />
          </Route>
          <Route element={<PermissionRoute permission="academic_years.view" />}>
            <Route path="/academic-years" element={<AcademicYears />} />
          </Route>
          {/* Maktabga tayyorlov filial: ta'lim narxi va kunlik davomat jurnali */}
          <Route element={<PermissionRoute permission="preschool_prices.view" />}>
            <Route path="/preschool-prices" element={<PreschoolPrices />} />
          </Route>
          <Route element={<PermissionRoute permission="preschool_attendances.view" />}>
            <Route path="/preschool-attendance" element={<PreschoolAttendance />} />
          </Route>
          {/* Maktabga tayyorlov shartnomasi: ro'yxat va yaratish (`student_contracts.*` dan alohida ruxsat) */}
          <Route element={<PermissionRoute permission="preschool_contracts.view" />}>
            <Route path="/preschool-contracts" element={<PreschoolContracts />} />
          </Route>
          <Route element={<PermissionRoute permission="preschool_contracts.create" />}>
            <Route path="/preschool-contracts/new" element={<PreschoolContractCreate />} />
          </Route>
          <Route path="/classes" element={<Classes />} />

          {/* Sotuv bo'limi */}
          <Route element={<PermissionRoute permission="lids.view" />}>
            <Route path="/lid" element={<Lid />} />
          </Route>
          <Route element={<PermissionRoute permission="ip_telefon_operators.view" />}>
            <Route path="/ip-telephone" element={<IpTelephone />} />
          </Route>
          <Route element={<PermissionRoute permission="rejection_reasons.view" />}>
            <Route path="/refusal-reasons" element={<RefusalReasons />} />
          </Route>
          <Route element={<PermissionRoute permission="sources.view" />}>
            <Route path="/sources" element={<Sources />} />
          </Route>
          <Route element={<PermissionRoute permission="tasks.view" />}>
            <Route path="/tasks" element={<Tasks />} />
            {/* Siklogramma — «Vazifalar» bo'limida; backendda alohida ruxsat yo'q, `tasks.view` bilan ochiladi. */}
            <Route path="/cyclogram" element={<Cyclogram />} />
          </Route>

          {/* Test */}
          <Route element={<PermissionRoute permission="questions.view" />}>
            <Route path="/questions" element={<Questions />} />
          </Route>

          {/* Chiqimlar */}
          <Route element={<PermissionRoute permission="expenses.view" />}>
            <Route path="/expenses/create" element={<Expenses />} />
          </Route>
          <Route element={<PermissionRoute permission="expense_categories.view" />}>
            <Route path="/expenses/category" element={<ExpenseCategory />} />
          </Route>
          <Route element={<PermissionRoute permission="expense_subcategories.view" />}>
            <Route path="/expenses/subcategory" element={<ExpenseSubCategory />} />
          </Route>

          {/* O'quvchilar */}
          <Route element={<PermissionRoute permission="student_attendance.view" />}>
            <Route path="/students-attendance" element={<StudentsAttendance />} />
          </Route>
          <Route element={<PermissionRoute permission="homework_submissions.view" />}>
            <Route path="/student-tasks" element={<StudentTasks />} />
          </Route>
          <Route element={<PermissionRoute permission="student_contracts.view" />}>
            <Route path="/students-contract" element={<StudentsContract />} />
          </Route>
          <Route element={<PermissionRoute permission="student_contracts.show" />}>
            <Route path="/students-contract/:id" element={<ContractDetails />} />
          </Route>
          <Route element={<PermissionRoute permission="student_contracts.create" />}>
            <Route path="/students-contract/adult" element={<StudentsContract />} />
            <Route path="/students-contract/minor" element={<UnderAge />} />
            <Route path="/students-contract/legal_bilateral" element={<LegalEntity />} />
            <Route
              path="/students-contract/legal_trilateral"
              element={<RepresentativeEntity />}
            />
          </Route>
          <Route element={<PermissionRoute permission="student_contracts.edit" />}>
            <Route path="/students-contract/adult/edit/:id" element={<StudentsContract />} />
            <Route path="/students-contract/minor/edit/:id" element={<UnderAge />} />
            <Route
              path="/students-contract/legal_bilateral/edit/:id"
              element={<LegalEntity />}
            />
            <Route
              path="/students-contract/legal_trilateral/edit/:id"
              element={<RepresentativeEntity />}
            />
          </Route>
          <Route element={<PermissionRoute permission="students.view" />}>
            <Route path="/students" element={<Students />} />
          </Route>

          {/* To'lovlar */}
          <Route element={<PermissionRoute permission="payments.view" />}>
            <Route path="/payments" element={<Payments />} />
          </Route>
          <Route element={<PermissionRoute permission="payment_gateway_commissions.view" />}>
            <Route path="/commissions" element={<Commissions />} />
          </Route>

          {/* Oyliklar */}
          <Route path="/salaries" element={<Salaries />} />

          {/* Xodimlar */}
          <Route element={<PermissionRoute permission="employees.view" />}>
            <Route path="/employees" element={<Employees />} />
          </Route>

          {/* Axlat qutisi */}
          <Route element={<PermissionRoute permission="trash.view" />}>
            <Route path="/trash" element={<TrashPage />} />
          </Route>
          {LEGACY_ARCHIVE_SECTIONS.map((section) => (
            <Route key={section} path={`/${section}/archive`} element={<Navigate to="/trash" replace />} />
          ))}
          {/* Moliya */}
          <Route element={<PermissionRoute permission="chart_of_accounts.view" />}>
            <Route path="/finances" element={<Finances />} />
          </Route>
          <Route element={<PermissionRoute permission="jamgarmas.view" />}>
            <Route path="/jamgarma" element={<JamgarmaPage />} />
          </Route>
          <Route element={<PermissionRoute permission="jamgarma_names.view" />}>
            <Route path="/jamgarma-names" element={<JamgarmaNamesPage />} />
          </Route>
          <Route element={<PermissionRoute permission="jamgarma_loans.view" />}>
            <Route path="/debts" element={<DebtsPage />} />
          </Route>
          <Route element={<PermissionRoute permission="fine_types.view" />}>
            <Route path="/fine-types" element={<FineTypes />} />
          </Route>
          <Route element={<PermissionRoute permission="daily_cash_reports.view" />}>
            <Route path="/daily-cash-reports" element={<DailyCashReports />} />
          </Route>
          {/* Generatsiya va avans/oylik jadvallari — bitta `payroll_sheets.view`.
              Generatsiya tugmasi sahifa ichida `payroll_sheets.generate` bilan. */}
          <Route element={<PermissionRoute permission="payroll_sheets.view" />}>
            <Route path="/finance-generation" element={<FinanceGeneration />} />
            <Route path="/advance-schedule" element={<AdvanceSchedule />} />
            <Route path="/salary-schedule" element={<SalarySchedule />} />
          </Route>

          {/* Ish haqi: taqsimlash (contracts'dan ochiladi) va tuzatishlar.
              Ruxsat sahifa ichida `Protected` orqali tekshiriladi. */}
          {/* Taqsimlash formasi — menyuda yo'q (Shartnomalar ro'yxatidagi tanga tugmasidan ochiladi); ilgari himoyasiz edi. */}
          <Route element={<PermissionRoute anyOf={PAYROLL_DISTRIBUTION_FORM} />}>
            <Route path="/payroll/distributions/:employeeId" element={<PayrollDistribution />} />
          </Route>
          <Route element={<PermissionRoute permission="payroll_adjustments.view" />}>
            <Route path="/payroll-adjustments" element={<PayrollAdjustments />} />
            <Route path="/payroll-adjustments/:id" element={<AdjustmentForm />} />
          </Route>
          <Route element={<PermissionRoute permission="payroll_adjustments.create" />}>
            <Route path="/payroll-adjustments/create" element={<AdjustmentForm />} />
          </Route>
          <Route element={<PermissionRoute permission="payroll_adjustments.edit" />}>
            <Route path="/payroll-adjustments/:id/edit" element={<AdjustmentForm />} />
          </Route>

          {/* Taqsimlangan oylikni direktor → bosh admin tasdiqlaydi. */}
          <Route element={<PermissionRoute permission="payroll_distributions.view" />}>
            <Route path="/payroll-distribution-requests" element={<PayrollDistributionRequests />} />
          </Route>

          {/* Kirishlar tarixi va faol sessiyalar */}
          <Route element={<PermissionRoute permission="login_histories.view" />}>
            <Route path="/login-history" element={<LoginHistory />} />
          </Route>

          <Route element={<PermissionRoute permission="settings.view" />}>
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
      </Suspense>
    </ChunkErrorBoundary>
  );
};

export default App;
