// Re-export all types
export type {} from './categories/types';

// Re-export all queries
export {
  getCategory,
  getCategoryByShortIdWithStats,
  getCategoryWithStats,
  internalListCategoriesHierarchical,
  listArchivedCategories,
  listCategories,
  listCategoriesHierarchical,
} from './categories/queries';

// Re-export all mutations
export { createCategory, createCategoryForMcp } from './categories/create';
export {
  deleteCategoriesForMcp,
  deleteCategoriesWithRecategorization,
  permanentlyDeleteCategory,
  processLargeCategoryDeletion,
  restoreCategory,
} from './categories/delete';
export { setCategoryFavorite } from './categories/favorites';
export {
  archiveCategories,
  archiveCategoriesForMcp,
  bulkReorderCategoriesForMcp,
  moveCategoryToGroup,
  moveCategoryToGroupForMcp,
  sortCategoriesForMcp,
  updateCategory,
  updateCategoryForMcp,
  updateCategorySortOrder,
  updateCategorySortOrderForMcp,
} from './categories/update';

// Re-export helpers that might be used elsewhere
export {
  MIN_GAP_THRESHOLD,
  SORT_ORDER_GAP,
  calculateSortOrderBetween,
  enrichCategoryWithStats,
  enrichCategoryWithType,
  restructureCategorySortOrders,
} from './categories/helpers';
