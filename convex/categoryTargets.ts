// Re-export all queries
export {
  getCategoryTargetMapByCategories,
  listCategoryTargets,
  listCategoryTargetsWithCalculations,
} from './categoryTargets/queries.js';

// Re-export all mutations
export { createCategoryTarget, createCategoryTargetForMcp } from './categoryTargets/create.js';
export {
  deleteCategoryTarget,
  deleteCategoryTargetByCategoryId,
  deleteCategoryTargetForMcp,
  removeCreditCardCategoryTargets,
} from './categoryTargets/delete.js';
export { updateCategoryTarget, updateCategoryTargetForMcp } from './categoryTargets/update.js';
