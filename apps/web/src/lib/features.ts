import type { CompanyFeatures } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** The company's choices that decide what every screen offers. Rarely change, so kept a while. */
export function useFeatures(): CompanyFeatures {
  const { data } = useQuery({
    queryKey: ['settings', 'features'],
    queryFn: () => api<CompanyFeatures>('/settings/features'),
    staleTime: 5 * 60_000,
  });
  return data ?? { overtimeEnabled: true };
}
