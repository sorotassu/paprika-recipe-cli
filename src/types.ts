/**
 * Paprika API Types
 */

export interface PaprikaConfig {
  email: string;
  password?: string;
  token?: string;
}

export interface RecipeStub {
  uid: string;
  hash: string;
}

export interface Recipe {
  uid: string;
  name: string;
  ingredients: string;
  directions: string;
  description: string;
  notes: string;
  nutritional_info: string;
  servings: string;
  difficulty: string;
  prep_time: string;
  cook_time: string;
  total_time: string;
  source: string;
  source_url: string;
  image_url: string;
  photo: string | null;
  photo_hash: string | null;
  photo_large: string | null;
  scale: string | null;
  hash: string;
  categories: string[];
  rating: number;
  in_trash: boolean;
  is_pinned: boolean;
  on_favorites: boolean;
  on_grocery_list: boolean;
  created: string;
  photo_url: string | null;
}

export interface RecipeWritePayload {
  uid: string;
  name: string;
  ingredients: string;
  directions: string;
  description: string;
  notes: string;
  nutritional_info: string;
  servings: string;
  difficulty: string;
  prep_time: string;
  cook_time: string;
  total_time: string;
  source: string;
  source_url: string;
  image_url: string | null;
  photo: string;
  photo_hash: string;
  photo_large: string | null;
  scale: string | null;
  hash: string;
  categories: string[];
  rating: number;
  in_trash: boolean;
  is_pinned: boolean;
  on_favorites: boolean;
  created: string;
  deleted: boolean;
}

export interface Meal {
  uid: string;
  recipe_uid: string | null;
  name: string;
  date: string;
  type: number; // 0=breakfast, 1=lunch, 2=dinner, 3=snack
  order_flag: number;
  type_uid?: string | null;
  scale?: string | null;
  is_ingredient?: boolean;
}

export interface MealType {
  uid: string;
  name: string;
  order_flag: number;
  color: string;
  export_all_day: boolean;
  export_time: number;
  original_type: number;
}

export interface MealWritePayload {
  uid: string;
  recipe_uid: string | null;
  name: string;
  date: string;
  type: number;
  order_flag: number;
  hash: string;
  deleted: boolean;
}

export interface GroceryItem {
  uid: string;
  name: string;
  ingredient: string;
  recipe_uid: string | null;
  recipe?: string | null;
  aisle: string;
  quantity: string;
  purchased: boolean;
  order_flag: number;
}

export interface Category {
  uid: string;
  name: string;
  order_flag: number;
  parent_uid: string | null;
}

export interface Bookmark {
  uid: string;
  title: string;
  url: string;
  order_flag: number;
}

export interface PantryItem {
  uid: string;
  ingredient: string;
  aisle: string;
  quantity?: string | null;
  expiration_date?: string | null;
  has_expiration?: boolean;
  in_stock?: boolean;
  purchase_date?: string | null;
  aisle_uid?: string | null;
  location_uid?: string | null;
  notes?: string | null;
}

export interface Menu {
  uid: string;
  name: string;
  notes: string;
  order_flag: number;
}

export interface MenuItem {
  uid: string;
  name: string;
  recipe_uid: string | null;
  menu_uid: string | null;
  order_flag: number;
}

export interface SyncStatusResponse {
  recipes: number;
  meals: number;
  groceries: number;
  categories: number;
  bookmarks: number;
  menus: number;
  menuitems: number;
  pantry: number;
  photos?: number;
  grocerylists?: number;
  groceryaisles?: number;
  groceryingredients?: number;
  mealtypes?: number;
  pantrylocations?: number;
}

export interface ApiResponse<T> {
  result: T;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Exit codes following CLI conventions
 */
export const ExitCode = {
  Success: 0,
  Failure: 1,
  InvalidUsage: 2,
  AuthFailure: 3,
} as const;
