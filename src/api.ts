/**
 * Paprika API Client
 *
 * REST client for Paprika Recipe Manager cloud sync API.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import type {
  PaprikaConfig,
  Recipe,
  RecipeStub,
  Meal,
  MealType,
  MealWritePayload,
  GroceryAisle,
  GroceryItem,
  GroceryList,
  GroceryWritePayload,
  Category,
  CategoryWritePayload,
  Bookmark,
  BookmarkWritePayload,
  PantryItem,
  Menu,
  MenuItem,
  SyncStatusResponse,
  ApiResponse,
  RecipeWritePayload,
} from "./types.js";

const BASE_URL = "https://www.paprikaapp.com/api/v2";
const LOGIN_URL = "https://www.paprikaapp.com/api/v1/account/login/";

interface LoginResponse {
  result: {
    token: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

export class PaprikaClient {
  private email: string;
  private password?: string;
  private token: string | null = null;

  constructor(config: PaprikaConfig) {
    this.email = config.email;
    this.password = config.password;
    this.token = config.token ?? null;
  }

  /**
   * Login to get JWT token
   */
  async login(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    if (!this.password) {
      throw new Error("Not authenticated. Run: paprika auth");
    }

    const response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `email=${encodeURIComponent(this.email)}&password=${encodeURIComponent(this.password)}`,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Login failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as LoginResponse;

    if (data.error) {
      throw new Error(`Login error: ${data.error.message}`);
    }

    this.token = data.result.token;
    return this.token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Ensure we have a token
    const token = await this.login();

    const url = `${BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string> | undefined),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401 || response.status === 403) {
        this.token = null;
        throw new Error(
          "Authentication token expired or was rejected. Run: paprika auth"
        );
      }
      throw new Error(`API error ${response.status}: ${text}`);
    }

    // Paprika returns gzip-compressed JSON
    const buffer = await response.arrayBuffer();
    let data: string;

    try {
      // Try to decompress gzip
      const decompressed = gunzipSync(Buffer.from(buffer));
      data = decompressed.toString("utf-8");
    } catch {
      // If not gzipped, use as-is
      data = Buffer.from(buffer).toString("utf-8");
    }

    const parsed = JSON.parse(data) as ApiResponse<T>;

    if (parsed.error) {
      if (
        /(expired|invalid|unauthorized|auth|token|credential|login)/i.test(
          parsed.error.message
        )
      ) {
        this.token = null;
        throw new Error(
          "Authentication token expired or was rejected. Run: paprika auth"
        );
      }
      throw new Error(`Paprika API error: ${parsed.error.message}`);
    }

    return parsed.result;
  }

  /**
   * Get list of all recipe stubs (uid + hash only)
   */
  async getRecipeList(): Promise<RecipeStub[]> {
    return this.request<RecipeStub[]>("/sync/recipes/");
  }

  /**
   * Get full recipe by UID
   */
  async getRecipe(uid: string): Promise<Recipe> {
    return this.request<Recipe>(`/sync/recipe/${uid}/`);
  }

  /**
   * Get all recipes with full details
   */
  async getAllRecipes(): Promise<Recipe[]> {
    const stubs = await this.getRecipeList();
    const recipes: Recipe[] = [];

    // Fetch in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < stubs.length; i += batchSize) {
      const batch = stubs.slice(i, i + batchSize);
      const batchRecipes = await Promise.all(
        batch.map((stub) => this.getRecipe(stub.uid))
      );
      recipes.push(...batchRecipes);

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < stubs.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return recipes;
  }

  /**
   * Get current sync status counts
   */
  async getStatus(): Promise<SyncStatusResponse> {
    return this.request<SyncStatusResponse>("/sync/status/");
  }

  /**
   * Create, update, or delete multiple entities of the same type
   */
  private async saveEntities<
    T extends { uid: string; hash: string; deleted: boolean }
  >(endpoint: string, items: T[]): Promise<void> {
    const form = new FormData();
    const filename = `${endpoint.slice(1, -1)}.gz`;
    form.append(
      "data",
      new Blob([gzipSync(Buffer.from(JSON.stringify(items), "utf-8"))], {
        type: "application/octet-stream",
      }),
      filename
    );

    await this.request<true>(endpoint, {
      method: "POST",
      body: form,
    });
  }

  /**
   * Get all bookmarks
   */
  async getBookmarks(): Promise<Bookmark[]> {
    return this.request<Bookmark[]>("/sync/bookmarks/");
  }

  /**
   * Create, update, or delete bookmark entries
   */
  async saveBookmarks(bookmarks: BookmarkWritePayload[]): Promise<void> {
    return this.saveEntities("/sync/bookmarks/", bookmarks);
  }

  /**
   * Get all meal types
   */
  async getMealTypes(): Promise<MealType[]> {
    return this.request<MealType[]>("/sync/mealtypes/");
  }

  /**
   * Get all meals
   */
  async getMeals(): Promise<Meal[]> {
    return this.request<Meal[]>("/sync/meals/");
  }

  /**
   * Create, update, or delete meal entries
   */
  async saveMeals(meals: MealWritePayload[]): Promise<void> {
    return this.saveEntities("/sync/meals/", meals);
  }

  /**
   * Get all grocery lists
   */
  async getGroceryLists(): Promise<GroceryList[]> {
    return this.request<GroceryList[]>("/sync/grocerylists/");
  }

  /**
   * Get all grocery aisles
   */
  async getGroceryAisles(): Promise<GroceryAisle[]> {
    return this.request<GroceryAisle[]>("/sync/groceryaisles/");
  }

  /**
   * Get all grocery items
   */
  async getGroceries(): Promise<GroceryItem[]> {
    return this.request<GroceryItem[]>("/sync/groceries/");
  }

  /**
   * Create, update, or delete grocery entries
   */
  async saveGroceries(items: GroceryWritePayload[]): Promise<void> {
    return this.saveEntities("/sync/groceries/", items);
  }

  /**
   * Get all pantry items
   */
  async getPantry(): Promise<PantryItem[]> {
    return this.request<PantryItem[]>("/sync/pantry/");
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<Category[]> {
    return this.request<Category[]>("/sync/categories/");
  }

  /**
   * Create, update, or delete category entries
   */
  async saveCategories(categories: CategoryWritePayload[]): Promise<void> {
    return this.saveEntities("/sync/categories/", categories);
  }

  /**
   * Get all menus
   */
  async getMenus(): Promise<Menu[]> {
    return this.request<Menu[]>("/sync/menus/");
  }

  /**
   * Get all menu items
   */
  async getMenuItems(): Promise<MenuItem[]> {
    return this.request<MenuItem[]>("/sync/menuitems/");
  }

  /**
   * Create or update a recipe by UID
   */
  async saveRecipe(recipe: RecipeWritePayload): Promise<Recipe> {
    const form = new FormData();
    form.append(
      "data",
      new Blob([gzipSync(Buffer.from(JSON.stringify(recipe), "utf-8"))], {
        type: "application/octet-stream",
      }),
      "recipe.gz"
    );

    await this.request<true>(`/sync/recipe/${recipe.uid}/`, {
      method: "POST",
      body: form,
    });

    return this.getRecipe(recipe.uid);
  }

  /**
   * Search recipes by name (local filter after fetching all)
   */
  async searchRecipes(query: string): Promise<Recipe[]> {
    const recipes = await this.getAllRecipes();
    const lowerQuery = query.toLowerCase();
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(lowerQuery) ||
        r.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get recipe by exact or partial name match
   */
  async findRecipeByName(name: string): Promise<Recipe | null> {
    const recipes = await this.getAllRecipes();
    const lowerName = name.toLowerCase();

    // Try exact match first
    const exact = recipes.find((r) => r.name.toLowerCase() === lowerName);
    if (exact) return exact;

    // Then try partial match
    const partial = recipes.find((r) =>
      r.name.toLowerCase().includes(lowerName)
    );
    return partial ?? null;
  }
}

export { generateSyncHash } from "./shared.js";
