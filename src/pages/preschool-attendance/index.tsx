import { useTranslation } from 'react-i18next';
import '../users/users.css';
import PreschoolJournal from '../../components/PreschoolJournal';

/** Maktabga tayyorlov guruhlari davomat jurnali — `preschool_attendances.view`. */
const PreschoolAttendance = () => {
  const { t } = useTranslation();

  return (
    <section className="users container">
      <h1 className="main-title">{t('preschool.attendance.title')}</h1>
      <PreschoolJournal />
    </section>
  );
};

export default PreschoolAttendance;
