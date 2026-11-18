import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import './users.css';
import { useTranslation } from 'react-i18next';
import type { User } from '../../types';
import { useOptions } from '../../hooks/useOptions';
import { formatPhone, isValidUzPhone, normalizePhone } from '../../utils/phone';
import { formatTime, toTashkentDate } from '@/utils/date';
import { notifyWarning } from '@/utils/notify';
import { fetchAllPages } from '@/api/fetchAllPages';
import MultiPicker from '@/components/MultiPicker';

const genPassword = () =>
  Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);

interface UpdateUserPayload {
  full_name?: string;
  username?: string;
  pinfl?: string;
  phone?: string;
  password?: string;
  roles?: number[];
  branch_ids?: number[];
  department_ids?: number[];
  position_id?: number;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** "Familiya Ism Sharif o'g'li" → { familiya, ism, sharif: "Sharif o'g'li" } (ortiqcha bo'shliqlar e'tiborga olinmaydi). */
const splitFullName = (fullName: string | null | undefined) => {
  const [familiya = '', ism = '', ...rest] = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return { familiya, ism, sharif: rest.join(' ') };
};

/** Maydonlarni bitta ism qilib yig'adi; bo'sh maydon ortiqcha bo'shliq qoldirmaydi. */
const joinFullName = (f: { familiya: string; ism: string; sharif: string }) =>
  [f.familiya, f.ism, f.sharif]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

const UserForm = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEditing = Boolean(id);

  const [userImage, setUserImage] = useState<File | null>(null);

  const [formData, setFormData] = useState({
    familiya: '',
    ism: '',
    sharif: '',
    pinfl: '',
    phone: '+998',
    username: '',
    password: genPassword(),
    start_date: '',
    role_ids: [] as string[],
    branch_ids: [] as string[],
    department_ids: [] as string[],
    position_id: '',
    is_active: true,
    created_at_edit: '',
    updated_at_edit: '',
  });

  // Tahrirlanayotgan foydalanuvchi. Avval `/users` (faqat 1-sahifa: 20 ta) ichidan qidirilardi —
  // 20 tadan keyingi foydalanuvchida forma bo'sh qolardi. Endi bittasini `/users/{id}` dan olamiz;
  // `users.show` ruxsati bo'lmasa — hamma sahifalarni yig'ib, ro'yxatdan topamiz.
  const { data: editingUserData } = useQuery<User | null>({
    queryKey: ['users', 'detail', id],
    enabled: isEditing,
    queryFn: async () => {
      try {
        const { data } = await API.get(`/users/${id}`, { silentError: true });
        const user = (data?.data ?? data) as User | undefined;
        if (user && user.id) return user;
      } catch {
        // ruxsat yo'q yoki topilmadi — pastda ro'yxatdan qidiramiz
      }
      const all = await fetchAllPages<User>('/users');
      return all.find((u) => u.id === Number(id)) ?? null;
    },
  });

  const editingUser: User | undefined = isEditing ? (editingUserData ?? undefined) : undefined;

  useEffect(() => {
    if (!editingUser) return;

    setFormData({
      // To'liq ism "Familiya Ism Sharif": 3-so'zdan keyingisi ham (masalan, "... Qurbonali o'g'li") "sharif" maydoniga kiradi.
      // Ilgari faqat 3 ta so'z olinardi — tahrirlab saqlaganda "o'g'li" yo'qolib qolardi.
      ...splitFullName(editingUser.full_name),
      pinfl: editingUser.pinfl || '',
      phone: formatPhone(editingUser.phone),
      username: editingUser.username,
      password: '',
      start_date: toTashkentDate(editingUser.created_at),
      role_ids: editingUser.roles?.map((r) => r.id.toString()) || [],
      branch_ids:
        editingUser.branches && editingUser.branches.length > 0
          ? editingUser.branches.map((b) => b.id.toString())
          : editingUser.branch
            ? [editingUser.branch.id.toString()]
            : [],
      department_ids: editingUser.departments?.map((d) => d.id.toString()) || [],
      position_id: editingUser.position?.id?.toString() || '',
      is_active: editingUser.is_active,
      created_at_edit: toTashkentDate(editingUser.created_at),
      updated_at_edit: toTashkentDate(editingUser.updated_at),
    });
  }, [editingUser]);

  const { data: rolesData } = useOptions('roles');
  const { data: branchesData } = useOptions('branches');
  const { data: departmentsData } = useOptions('departments');

  const roles = rolesData || [];
  const branches = branchesData || [];
  // Bo'lim faqat tanlangan filiallardan biriga biriktirilgan bo'lsa tanlanadi (`/options/departments` har bo'lim bilan
  // uning `branches` ro'yxatini qaytaradi). Filial tanlanmagan bo'lsa — hammasi (avval tanlab bo'lingan bo'limlar o'zgarmaydi).
  const departments = (departmentsData || []).filter(
    (d) =>
      formData.branch_ids.length === 0 ||
      formData.department_ids.includes(d.id.toString()) ||
      ((d.branches as { id: number }[] | undefined) ?? []).some((b) =>
        formData.branch_ids.includes(b.id.toString()),
      ),
  );

  // Rol / filial / bo'lim — `MultiPicker` (Ctrl/Shift bilan bir nechtasini birdaniga tanlash). Forma holatida
  // id'lar matn (`string[]`) bo'lib turadi, `MultiPicker` esa `number[]` kutadi — shu yerda o'giriladi.
  const toIds = (ids: string[]) => ids.map(Number);
  const setRoleIds = (ids: number[]) => setFormData((f) => ({ ...f, role_ids: ids.map(String) }));
  const setBranchIds = (ids: number[]) => setFormData((f) => ({ ...f, branch_ids: ids.map(String) }));
  const setDepartmentIds = (ids: number[]) =>
    setFormData((f) => ({ ...f, department_ids: ids.map(String) }));

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        full_name: joinFullName(formData),
        username: formData.username,
        pinfl: formData.pinfl,
        phone: normalizePhone(formData.phone),
        password: formData.password,
        position_id: formData.position_id ? Number(formData.position_id) : undefined,
        branch_ids: formData.branch_ids.map(Number),
        department_ids: formData.department_ids.map(Number),
        roles: formData.role_ids.map(Number),
        is_active: formData.is_active,
      };

      if (userImage) {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => {
          if (v === undefined) return;
          if (Array.isArray(v)) {
            v.forEach((item) => fd.append(`${k}[]`, String(item)));
          } else {
            fd.append(k, String(v));
          }
        });
        fd.append('image', userImage);
        const res = await API.post('/users', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res.data;
      }

      const res = await API.post('/users', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserImage(null);
      navigate('/users');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id: userId, updates }: { id: number; updates: UpdateUserPayload }) => {
      const { data } = await API.put(`/users/${userId}`, updates);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    },
  });

  const handleSubmit = () => {
    if (!isValidUzPhone(formData.phone)) {
      notifyWarning(t('common.phoneFormatError'));
      return;
    }
    if (editingUser) {
      // Backend `UpdateUserRequest`: pinfl `sometimes|required|min:14|max:14` — bo'sh yoki to'liq bo'lmagan JSHSHIR
      // yuborilsa butun saqlash 422 bilan rad etiladi. To'liq bo'lmasa oldindan ogohlantiramiz, bo'sh bo'lsa yubormaymiz.
      if (formData.pinfl && formData.pinfl.length !== 14) {
        notifyWarning(t('users.pinflError'));
        return;
      }
      updateMutation.mutate({
        id: editingUser.id,
        updates: {
          full_name: joinFullName(formData),
          username: formData.username,
          pinfl: formData.pinfl || undefined,
          phone: normalizePhone(formData.phone),
          roles: formData.role_ids.map(Number),
          branch_ids: formData.branch_ids.map(Number),
          department_ids: formData.department_ids.map(Number),
          position_id: formData.position_id ? Number(formData.position_id) : undefined,
          is_active: formData.is_active,
          password: formData.password || undefined,
          // Sana maydonlari ildizdan oldin har safar yuborilardi: kun UTC bo'yicha siljib,
          // vaqt esa "hozir"ga almashardi — har tahrirda foydalanuvchining yaratilgan sanasi buzilardi.
          // Endi faqat admin sanani o'zgartirgan bo'lsa yuboriladi va asl vaqt saqlanadi.
          created_at:
            formData.created_at_edit &&
            formData.created_at_edit !== toTashkentDate(editingUser.created_at)
              ? `${formData.created_at_edit} ${formatTime(editingUser.created_at, new Date().toTimeString().slice(0, 8))}`
              : undefined,
          updated_at:
            formData.updated_at_edit &&
            formData.updated_at_edit !== toTashkentDate(editingUser.updated_at)
              ? `${formData.updated_at_edit} ${formatTime(editingUser.updated_at, new Date().toTimeString().slice(0, 8))}`
              : undefined,
        },
      });
    } else {
      createMutation.mutate();
    }
  };

  return (
    <section className="usrf-page">
      <div className="usrf-card">
        <h1 className="usrf-heading">
          {isEditing ? t('users.userEditTitle') : t('users.addNewUserTitle')}
        </h1>

        <div className="usrf-body">
          <div className="add-user-form">
            <div className="form-left">
              <div className="form-group">
                <label>{t('users.lastName')}</label>
                <input
                  type="text"
                  value={formData.familiya}
                  onChange={(e) => setFormData({ ...formData, familiya: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('users.firstName')}</label>
                <input
                  type="text"
                  value={formData.ism}
                  onChange={(e) => setFormData({ ...formData, ism: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('users.familyName')}</label>
                <input
                  type="text"
                  value={formData.sharif}
                  onChange={(e) => setFormData({ ...formData, sharif: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('users.pinfl')}</label>
                <input
                  type="text"
                  value={formData.pinfl}
                  maxLength={14}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 14);
                    setFormData({ ...formData, pinfl: val });
                  }}
                />
                {formData.pinfl.length > 0 && formData.pinfl.length !== 14 && (
                  <span
                    className="error-text"
                    style={{
                      color: 'red',
                      fontSize: '12px',
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    {t('users.pinflError')}
                  </span>
                )}
              </div>
              <div className="form-group">
                <label>{t('users.phoneNumber')}</label>
                <input
                  type="tel"
                  value={formData.phone}
                  placeholder="+998901234567"
                  onChange={(e) =>
                    setFormData({ ...formData, phone: formatPhone(e.target.value) })
                  }
                />
                {formData.phone !== '+998' && !isValidUzPhone(formData.phone) && (
                  <span
                    className="error-text"
                    style={{
                      color: 'red',
                      fontSize: '12px',
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    {t('common.phoneFormatError')}
                  </span>
                )}
              </div>
              <div className="form-group">
                <label>{t('users.loginText')}</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('users.password')}</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={t('users.passwordPlaceholder')}
                  />
                  <button
                    className="refresh-password"
                    type="button"
                    title={t('users.generatePasswordTooltip')}
                    onClick={() => {
                      const newPass = genPassword();
                      setFormData({ ...formData, password: newPass });
                    }}
                  >
                    🔄
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>{t('users.startDate')}</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                />
              </div>

              {editingUser && (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>{t('users.createdAt')}</label>
                    <input
                      type="date"
                      value={formData.created_at_edit}
                      onChange={(e) =>
                        setFormData({ ...formData, created_at_edit: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>{t('users.updatedAt')}</label>
                    <input
                      type="date"
                      value={formData.updated_at_edit}
                      onChange={(e) =>
                        setFormData({ ...formData, updated_at_edit: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="form-right">
              <div className="form-group">
                <label>{t('users.roles')}</label>
                <MultiPicker
                  options={roles.map((r) => ({ value: Number(r.id), label: r.label }))}
                  value={toIds(formData.role_ids)}
                  onChange={setRoleIds}
                  placeholder={t('users.choose')}
                />
              </div>

              <div className="form-group">
                <label>{t('users.branches')}</label>
                <MultiPicker
                  options={branches.map((b) => ({ value: Number(b.id), label: b.label }))}
                  value={toIds(formData.branch_ids)}
                  onChange={setBranchIds}
                  placeholder={t('users.choose')}
                />
              </div>

              <div className="form-group">
                <label>{t('users.departments')}</label>
                <MultiPicker
                  options={departments.map((d) => ({ value: Number(d.id), label: d.label }))}
                  value={toIds(formData.department_ids)}
                  onChange={setDepartmentIds}
                  placeholder={t('users.choose')}
                />
              </div>

              {isEditing && (
                <div className="form-group">
                  <label>{t('users.endDate')}</label>
                  <input type="date" />
                </div>
              )}

              <div className="form-group">
                <div className="toggle-buttons">
                  <button
                    type="button"
                    className={formData.is_active ? '' : 'active'}
                    onClick={() => setFormData({ ...formData, is_active: false })}
                  >
                    {t('users.inactive')}
                  </button>
                  <button
                    type="button"
                    className={formData.is_active ? 'active' : ''}
                    onClick={() => setFormData({ ...formData, is_active: true })}
                  >
                    {t('users.active')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="usrf-footer">
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={
              createMutation.isPending || updateMutation.isPending || formData.pinfl.length !== 14
            }
          >
            {createMutation.isPending || updateMutation.isPending
              ? t('users.saving')
              : t('users.save')}
          </button>

          <button className="cancel" onClick={() => navigate('/users')}>
            {t('users.cancel')}
          </button>
        </div>
      </div>
    </section>
  );
};

export default UserForm;
