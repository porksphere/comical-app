import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import type { CoverGlow } from '@/lib/cover-glow';
import { readCoverGlow } from '@/lib/cover-glow-reader';

/** A cover's dark-mode glow tints, or `undefined` until they're read (and for good where they can't
 *  be). `uri` undefined asks for nothing: light mode has no use for them. */
export function useCoverGlow(uri: string | undefined): CoverGlow | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.coverGlow(uri ?? ''),
    queryFn: () => readCoverGlow(uri ?? ''),
    enabled: !!uri,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? undefined;
}
