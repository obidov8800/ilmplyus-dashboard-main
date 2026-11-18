import { Button, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../store/useAuthStore';

/**
 * Foydalanuvchida birorta sahifaga ruxsat yo'q (rol hali sozlanmagan). Bosh sahifa (`/`) endi dashboard
 * emas, balki birinchi ochiq sahifaga yo'naltiradi — ochiq sahifa bo'lmasa shu xabar ko'rsatiladi.
 */
const NoAccess = () => {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <Stack align="center" gap="xs" maw={460} ta="center">
        <i className="fa-solid fa-lock" style={{ fontSize: 40, color: '#94a3b8' }} />
        <Title order={3}>{t('noAccess.title')}</Title>
        <Text c="dimmed">{t('noAccess.text')}</Text>
        <Button variant="light" mt="sm" onClick={() => logout()}>
          {t('noAccess.logout')}
        </Button>
      </Stack>
    </div>
  );
};

export default NoAccess;
