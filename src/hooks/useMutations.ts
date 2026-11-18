import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

/**
 * Reusable hook for CREATE operations.
 * @param mutationFn Function that performs the API call.
 * @param invalidateKeys Array of query keys to invalidate on success.
 */
export function useCreateMutation<TData = unknown, TError = Error, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidateKeys: string[][] = [],
): UseMutationResult<TData, TError, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<TData, TError, TVariables>({
    mutationFn,
    // `invalidateQueries` o'zi ham qayta so'rov (refetch) yuboradi, lekin
    // avval bu yerda AWAIT qilinmasdi — shu sabab `.mutate(vars, {onSuccess})`
    // orqali berilgan chaqiruvchi callback (masalan modalni yopish) yangi
    // ma'lumot hali kelmasdanoq ishga tushardi. Ba'zi hollarda (masalan
    // modal yopilgach boshqa komponent darhol qayta render bo'lsa) bu
    // ro'yxat yangilanishini "sahifani yangilamaguncha ko'rinmaydi"gan
    // holatga olib kelishi mumkin edi. Endi hammasi tugagunicha kutiladi.
    onSuccess: async () => {
      await Promise.all(
        invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/**
 * Reusable hook for UPDATE operations.
 * @param mutationFn Function that performs the API call.
 * @param invalidateKeys Array of query keys to invalidate on success.
 */
export function useUpdateMutation<TData = unknown, TError = Error, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidateKeys: string[][] = [],
): UseMutationResult<TData, TError, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<TData, TError, TVariables>({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(
        invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/**
 * Reusable hook for DELETE operations.
 * @param mutationFn Function that performs the API call.
 * @param invalidateKeys Array of query keys to invalidate on success.
 */
export function useDeleteMutation<TData = unknown, TError = Error, TVariables = number | string>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidateKeys: string[][] = [],
): UseMutationResult<TData, TError, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<TData, TError, TVariables>({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(
        invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}
