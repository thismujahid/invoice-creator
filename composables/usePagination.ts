export function usePagination<T>(source: () => T[], defaultPerPage = 10) {
  const currentPage = ref(1);
  const currentPerPage = ref(defaultPerPage);

  const totalPages = computed(() => Math.max(1, Math.ceil(source().length / currentPerPage.value)));

  // FLAG [B9-FIXED]: length is ceiled; clamp page when filter shrinks list.
  watch([() => source().length, currentPerPage], () => {
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
  });

  const paged = computed<T[]>(() => {
    const start = (currentPage.value - 1) * currentPerPage.value;
    return source().slice(start, start + currentPerPage.value);
  });

  function resetPage() {
    currentPage.value = 1;
  }

  return { currentPage, currentPerPage, totalPages, paged, resetPage };
}
