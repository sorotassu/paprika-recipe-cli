/**
 * Paprika API Client
 *
 * REST client for Paprika Recipe Manager cloud sync API.
 */

import { gunzipSync } from "node:zlib";
import type {
  PaprikaConfig,
  Recipe,
  RecipeStub,
  Meal,
  GroceryItem,
  Category,
  ApiResponse,
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
  private password: string;
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
   * Get all meals
   */
  async getMeals(): Promise<Meal[]> {
    return this.request<Meal[]>("/sync/meals/");
  }

  /**
   * Get all grocery items
   */
  async getGroceries(): Promise<GroceryItem[]> {
    return this.request<GroceryItem[]>("/sync/groceries/");
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<Category[]> {
    return this.request<Category[]>("/sync/categories/");
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
