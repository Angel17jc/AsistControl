import type { CompanyFeatures } from '@asistcontrol/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from './api';

/** One cache entry for the company's choices, whoever reads them and however fresh they need it. */
export const featuresQuery = queryOptions({
  queryKey: ['settings', 'features'],
  queryFn: () => api<CompanyFeatures>('/settings/features'),
});

/**
 * The company's choices that decide what every screen offers. Rarely change, so kept a while,
 * and assumed on while loading. Good enough to show or hide things; a form that saves one of
 * them reads `featuresQuery` fresh instead.
 */
export function useFeatures(): CompanyFeatures {
  const { data } = useQuery({ ...featuresQuery, staleTime: 5 * 60_000 });
  return data ?? { overtimeEnabled: true };
}
