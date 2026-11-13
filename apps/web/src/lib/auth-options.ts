import type { AuthOptions } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/**
 * What the sign-in pages may offer, asked before anyone signs in. Unknown while loading: the
 * pages then offer the safe path (ask an administrator) until the answer arrives.
 */
export function useAuthOptions(): AuthOptions | undefined {
  const { data } = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: () => api<AuthOptions>('/auth/options'),
    staleTime: 5 * 60_000,
  });
  return data;
}
