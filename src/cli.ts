#!/usr/bin/env node

/**
 * Paprika CLI - Command line interface for Paprika Recipe Manager
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { createInterface } from "node:readline";
import { generateSyncHash, PaprikaClient } from "./api.js";
import {
  loadConfig,
  loadConfigFromEnv,
  saveConfig,
  requireConfig,
  getConfigPath,
  clearConfig,
} from "./config.js";
import type {
  Bookmark,
  Category,
  GroceryAisle,
  GroceryItem,
  GroceryList,
  GroceryWritePayload,
  Meal,
  MealType,
  MealWritePayload,
  Menu,
  MenuItem,
  PantryItem,
  Recipe,
  RecipeWritePayload,
  SyncStatusResponse,
} from "./types.js";
import { ExitCode } from "./types.js";
import { setNoColor, printError, printSuccess, style } from "./output.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("paprika")
  .description("Unofficial CLI for Paprika Recipe Manager")
  .version(VERSION, "-V, --version", "Show version number")
  .option("--no-color", "Disable colored output")
  .configureOutput({
    writeErr: (str) => process.stderr.write(str),
    writeOut: (str) => process.stdout.write(str),
    outputError: (str, write) => write(str),
  })
  .exitOverride((err) => {
    if (
      err.code === "commander.missingArgument" ||
      err.code === "commander.unknownOption" ||
      err.code === "commander.invalidArgument" ||
      err.code === "commander.missingMandatoryOptionValue"
    ) {
      process.exit(ExitCode.InvalidUsage);
    }
    process.exit(err.exitCode);
  })
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts() as { color?: boolean };
    if (opts.color === false) {
      setNoColor(true);
    }
  });

/**
 * Prompt for input with optional hidden mode (for passwords)
 */
function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");

      let password = "";
      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolve(password);
        } else if (char === "\u0003") {
          // Ctrl-C
          stdin.setRawMode(false);
          rl.close();
          process.exit(ExitCode.Failure);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// ============================================
// Auth Commands
// ============================================

program
  .command("auth")
  .description("Authenticate with Paprika cloud sync (interactive)")
  .action(async () => {
    if (!process.stdin.isTTY) {
      printError("Interactive authentication requires a TTY.");
      printError(
        "For non-interactive use, set PAPRIKA_EMAIL and PAPRIKA_PASSWORD environment variables."
      );
      process.exit(ExitCode.InvalidUsage);
    }

    try {
      const email = await prompt("Email: ");
      const password = await prompt("Password: ", true);

      if (!email || !password) {
        printError("Email and password are required.");
        process.exit(ExitCode.InvalidUsage);
      }

      console.log("Verifying credentials...");
      const client = new PaprikaClient({ email, password });
      const token = await client.login();

      saveConfig({ email, token });
      printSuccess("Authenticated successfully.");
      console.log(style.dim(`Config saved to ${getConfigPath()}`));
    } catch (error) {
      printError(
        `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(ExitCode.AuthFailure);
    }
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    clearConfig();
    printSuccess("Credentials cleared.");
  });

program
  .command("whoami")
  .description("Show current authenticated user")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) => {
    const config = loadConfigFromEnv() ?? loadConfig();
    if (!config?.email || (!config.token && !config.password)) {
      if (options.json) {
        console.log(JSON.stringify({ authenticated: false }));
      } else {
        console.log("Not authenticated. Run: paprika auth");
      }
      return;
    }
    if (options.json) {
      console.log(
        JSON.stringify({ authenticated: true, email: config.email }, null, 2)
      );
    } else {
      console.log(`Authenticated as: ${style.bold(config.email)}`);
    }
  });

// ============================================
// Read-only Utility Commands
// ============================================

program
  .command("status")
  .description("Show Paprika sync object counts")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const status = await client.getStatus();

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        const rows: Array<[string, number]> = Object.entries(status)
          .filter(([, value]) => typeof value === "number")
          .sort((a, b) => a[0].localeCompare(b[0])) as Array<[string, number]>;

        console.log("\nSync status:\n");
        for (const [key, value] of rows) {
          console.log(`• ${key}: ${style.bold(String(value))}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("bookmarks")
  .description("List saved Paprika bookmarks")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const bookmarks = await client.getBookmarks();

      if (options.json) {
        console.log(JSON.stringify(bookmarks, null, 2));
      } else if (bookmarks.length === 0) {
        console.log("No bookmarks found.");
      } else {
        console.log(`\nBookmarks (${bookmarks.length}):\n`);
        for (const bookmark of bookmarks.sort((a, b) =>
          a.title.localeCompare(b.title)
        )) {
          console.log(`• ${style.bold(bookmark.title)}`);
          console.log(`  ${style.dim(bookmark.url)}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Recipe Commands
// ============================================

program
  .command("recipes")
  .description("List all recipes")
  .option("--json", "Output as JSON")
  .option("--category <category>", "Filter by category name")
  .action(async (options: { json?: boolean; category?: string }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      if (!options.json) {
        console.log("Fetching recipes...");
      }
      const recipes = await client.getAllRecipes();
      let active = recipes.filter((r) => !r.in_trash);

      // Filter by category if specified
      if (options.category) {
        const categoryLower = options.category.toLowerCase();
        active = active.filter((r) =>
          r.categories.some((c) => c.toLowerCase().includes(categoryLower))
        );
      }

      if (options.json) {
        console.log(JSON.stringify(active, null, 2));
      } else {
        const categoryMsg = options.category
          ? ` in category "${options.category}"`
          : "";
        console.log(`\nFound ${active.length} recipes${categoryMsg}:\n`);
        for (const recipe of active.sort((a, b) =>
          a.name.localeCompare(b.name)
        )) {
          const rating =
            recipe.rating > 0 ? style.dim(` (${recipe.rating}★)`) : "";
          console.log(`• ${style.bold(recipe.name)}${rating}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

/**
 * Check if a string looks like a UUID
 */
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

type ImportedRecipeInput = Partial<RecipeWritePayload> & {
  uid?: string;
  categories?: string[];
};

function normalizeImportedCategories(
  categories: ImportedRecipeInput["categories"] | undefined,
  categoryMap: Map<string, string>,
  existingCategories: string[] = []
): string[] {
  if (categories === undefined) {
    return existingCategories;
  }

  return categories.map((value) => {
    if (typeof value !== "string") {
      throw new Error(`Invalid category value: ${String(value)}`);
    }

    if (isUuid(value)) {
      return value.toUpperCase();
    }

    const match = categoryMap.get(value.trim().toLowerCase());
    if (!match) {
      throw new Error(`Unknown category: ${value}`);
    }

    return match;
  });
}

function buildCategoryMap(categories: Category[]): Map<string, string> {
  return new Map(
    categories.map((category) => [category.name.trim().toLowerCase(), category.uid])
  );
}

function normalizeImportedRecipe(
  input: ImportedRecipeInput,
  options: {
    categoryMap: Map<string, string>;
    existingRecipe?: Recipe | null;
  }
): RecipeWritePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Each imported recipe must be a JSON object.");
  }

  const existingRecipe = options.existingRecipe ?? null;
  const recipe: RecipeWritePayload = {
    uid:
      existingRecipe?.uid ??
      (typeof input.uid === "string" && isUuid(input.uid)
        ? input.uid.toUpperCase()
        : randomUUID().toUpperCase()),
    name:
      typeof input.name === "string"
        ? input.name.trim()
        : existingRecipe?.name ?? "",
    ingredients:
      typeof input.ingredients === "string"
        ? input.ingredients
        : existingRecipe?.ingredients ?? "",
    directions:
      typeof input.directions === "string"
        ? input.directions
        : existingRecipe?.directions ?? "",
    description:
      typeof input.description === "string"
        ? input.description
        : existingRecipe?.description ?? "",
    notes:
      typeof input.notes === "string" ? input.notes : existingRecipe?.notes ?? "",
    nutritional_info:
      typeof input.nutritional_info === "string"
        ? input.nutritional_info
        : existingRecipe?.nutritional_info ?? "",
    servings:
      typeof input.servings === "string"
        ? input.servings
        : existingRecipe?.servings ?? "",
    difficulty:
      typeof input.difficulty === "string"
        ? input.difficulty
        : existingRecipe?.difficulty ?? "",
    prep_time:
      typeof input.prep_time === "string"
        ? input.prep_time
        : existingRecipe?.prep_time ?? "",
    cook_time:
      typeof input.cook_time === "string"
        ? input.cook_time
        : existingRecipe?.cook_time ?? "",
    total_time:
      typeof input.total_time === "string"
        ? input.total_time
        : existingRecipe?.total_time ?? "",
    source:
      typeof input.source === "string" ? input.source : existingRecipe?.source ?? "",
    source_url:
      typeof input.source_url === "string"
        ? input.source_url
        : existingRecipe?.source_url ?? "",
    image_url:
      typeof input.image_url === "string"
        ? input.image_url
        : existingRecipe?.image_url ?? null,
    photo:
      typeof input.photo === "string" ? input.photo : existingRecipe?.photo ?? "",
    photo_hash:
      typeof input.photo_hash === "string"
        ? input.photo_hash
        : existingRecipe?.photo_hash ?? "",
    photo_large:
      typeof input.photo_large === "string"
        ? input.photo_large
        : existingRecipe?.photo_large ?? null,
    scale:
      typeof input.scale === "string" || input.scale === null
        ? input.scale
        : existingRecipe?.scale ?? null,
    hash: "",
    categories: normalizeImportedCategories(
      input.categories,
      options.categoryMap,
      existingRecipe?.categories ?? []
    ),
    rating:
      typeof input.rating === "number" && Number.isFinite(input.rating)
        ? Math.max(0, Math.trunc(input.rating))
        : existingRecipe?.rating ?? 0,
    in_trash:
      typeof input.in_trash === "boolean"
        ? input.in_trash
        : existingRecipe?.in_trash ?? false,
    is_pinned:
      typeof input.is_pinned === "boolean"
        ? input.is_pinned
        : existingRecipe?.is_pinned ?? false,
    on_favorites:
      typeof input.on_favorites === "boolean"
        ? input.on_favorites
        : existingRecipe?.on_favorites ?? false,
    created:
      typeof input.created === "string"
        ? input.created.trim()
        : existingRecipe?.created ??
          new Date().toISOString().slice(0, 19).replace("T", " "),
    deleted: typeof input.deleted === "boolean" ? input.deleted : false,
  };

  if (!recipe.name) {
    throw new Error("Imported recipe is missing a name.");
  }

  const { hash: _hash, ...hashInput } = recipe;

  recipe.hash = createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(Object.entries(hashInput).sort())))
    .digest("hex")
    .toUpperCase();

  return recipe;
}

async function resolveRecipeIdentifier(
  client: PaprikaClient,
  identifier: string,
  options: { includeTrash?: boolean } = {}
): Promise<Recipe | null> {
  if (isUuid(identifier)) {
    try {
      return await client.getRecipe(identifier.toUpperCase());
    } catch {
      return null;
    }
  }

  const recipes = await client.getAllRecipes();
  const filtered = options.includeTrash ? recipes : recipes.filter((recipe) => !recipe.in_trash);
  const normalized = identifier.trim().toLowerCase();
  const exactMatches = filtered.filter(
    (recipe) => recipe.name.trim().toLowerCase() === normalized
  );

  if (exactMatches.length > 1) {
    throw new Error(`Multiple recipes named "${identifier}". Use the recipe UID.`);
  }
  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }

  const partialMatches = filtered.filter((recipe) =>
    recipe.name.trim().toLowerCase().includes(normalized)
  );

  if (partialMatches.length > 1) {
    const names = partialMatches.slice(0, 5).map((recipe) => recipe.name).join(", ");
    throw new Error(
      `Multiple recipes matched "${identifier}": ${names}. Use a more specific name or the recipe UID.`
    );
  }

  return partialMatches[0] ?? null;
}

function readSingleImportedRecipe(path: string): ImportedRecipeInput {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as ImportedRecipeInput | ImportedRecipeInput[];

  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      throw new Error("Expected a single recipe object for this command.");
    }
    return parsed[0]!;
  }

  return parsed;
}

function normalizeMealDate(input: string): string {
  const value = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value} 00:00:00`;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  throw new Error(`Invalid date: ${input}. Use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS.`);
}

function getMealDateKey(date: string): string {
  return date.slice(0, 10);
}

async function resolveMealType(
  client: PaprikaClient,
  identifier: string
): Promise<MealType> {
  const mealTypes = await client.getMealTypes();
  const trimmed = identifier.trim();
  const numeric = Number(trimmed);

  if (Number.isInteger(numeric) && numeric >= 0) {
    const byOriginalType = mealTypes.find((mealType) => mealType.original_type === numeric);
    if (byOriginalType) {
      return byOriginalType;
    }
  }

  const normalized = trimmed.toLowerCase();
  const aliasMap = new Map<string, number>([
    ["breakfast", 0],
    ["breakfasts", 0],
    ["lunch", 1],
    ["lunches", 1],
    ["dinner", 2],
    ["dinners", 2],
    ["snack", 3],
    ["snacks", 3],
  ]);
  const aliasedType = aliasMap.get(normalized);
  if (aliasedType !== undefined) {
    const aliased = mealTypes.find((mealType) => mealType.original_type === aliasedType);
    if (aliased) {
      return aliased;
    }
  }

  const exact = mealTypes.find((mealType) => mealType.name.trim().toLowerCase() === normalized);
  if (exact) {
    return exact;
  }

  const partialMatches = mealTypes.filter((mealType) =>
    mealType.name.trim().toLowerCase().includes(normalized)
  );
  if (partialMatches.length > 1) {
    const names = partialMatches.map((mealType) => mealType.name).join(", ");
    throw new Error(`Multiple meal types matched "${identifier}": ${names}`);
  }
  if (partialMatches.length === 1) {
    return partialMatches[0]!;
  }

  throw new Error(`Unknown meal type: ${identifier}`);
}

function toMealWritePayload(meal: Meal, overrides: Partial<MealWritePayload> = {}): MealWritePayload {
  return {
    uid: meal.uid,
    recipe_uid: meal.recipe_uid,
    name: meal.name,
    date: meal.date,
    type: meal.type,
    order_flag: meal.order_flag,
    hash: generateSyncHash(),
    deleted: false,
    ...overrides,
  };
}

function findMealByUid(meals: Meal[], uid: string): Meal | null {
  const normalized = uid.trim().toUpperCase();
  return meals.find((meal) => meal.uid.toUpperCase() === normalized) ?? null;
}

function getNextMealOrderFlag(
  meals: Meal[],
  date: string,
  type: number,
  skipUid?: string
): number {
  return meals.filter(
    (meal) =>
      meal.uid !== skipUid &&
      meal.date === date &&
      meal.type === type
  ).length;
}

async function resolveGroceryAisle(
  client: PaprikaClient,
  identifier?: string
): Promise<GroceryAisle | null> {
  if (!identifier) {
    return null;
  }

  const aisles = await client.getGroceryAisles();
  const trimmed = identifier.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedUid = trimmed.toUpperCase();
  const byUid = aisles.find((aisle) => aisle.uid.toUpperCase() === normalizedUid);
  if (byUid) {
    return byUid;
  }

  const normalized = trimmed.toLowerCase();
  const exact = aisles.find((aisle) => aisle.name.trim().toLowerCase() === normalized);
  if (exact) {
    return exact;
  }

  const partialMatches = aisles.filter((aisle) =>
    aisle.name.trim().toLowerCase().includes(normalized)
  );
  if (partialMatches.length > 1) {
    const names = partialMatches.map((aisle) => aisle.name).join(", ");
    throw new Error(`Multiple grocery aisles matched "${identifier}": ${names}`);
  }
  if (partialMatches.length === 1) {
    return partialMatches[0]!;
  }

  throw new Error(`Unknown grocery aisle: ${identifier}`);
}

async function getDefaultGroceryList(client: PaprikaClient): Promise<GroceryList> {
  const lists = await client.getGroceryLists();
  const defaultList = lists.find((list) => list.is_default);
  if (defaultList) {
    return defaultList;
  }
  if (lists.length === 1) {
    return lists[0]!;
  }
  if (lists.length === 0) {
    throw new Error("No Paprika grocery lists were found.");
  }
  throw new Error("Multiple grocery lists found but no default list is marked.");
}

function findGroceryByUid(items: GroceryItem[], uid: string): GroceryItem | null {
  const normalized = uid.trim().toUpperCase();
  return items.find((item) => item.uid.toUpperCase() === normalized) ?? null;
}

function getNextGroceryOrderFlag(
  items: GroceryItem[],
  listUid: string,
  skipUid?: string
): number {
  return items.filter(
    (item) => item.uid !== skipUid && item.list_uid === listUid
  ).reduce((max, item) => Math.max(max, item.order_flag), -1) + 1;
}

function toGroceryWritePayload(
  item: GroceryItem,
  overrides: Partial<GroceryWritePayload> = {}
): GroceryWritePayload {
  if (!item.list_uid) {
    throw new Error(`Grocery item ${item.uid} is missing list_uid.`);
  }

  return {
    uid: item.uid,
    name: item.name,
    ingredient: item.ingredient,
    recipe_uid: item.recipe_uid,
    recipe: item.recipe ?? null,
    instruction: item.instruction ?? "",
    quantity: item.quantity,
    purchased: item.purchased,
    order_flag: item.order_flag,
    separate: item.separate ?? false,
    aisle: item.aisle,
    aisle_uid: item.aisle_uid ?? null,
    list_uid: item.list_uid,
    hash: generateSyncHash(),
    deleted: false,
    ...overrides,
  };
}

program
  .command("recipe")
  .description("Get a recipe by UID or name")
  .argument("<identifier>", "Recipe UID or name (partial match supported)")
  .option("--json", "Output as JSON")
  .option("--ingredients-only", "Only show ingredients")
  .action(
    async (
      identifier: string,
      options: { json?: boolean; ingredientsOnly?: boolean }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        let recipe: Recipe | null = null;

        // If it looks like a UUID, try fetching directly first
        if (isUuid(identifier)) {
          try {
            recipe = await client.getRecipe(identifier);
          } catch {
            // UID not found, fall through to name search
          }
        }

        // If not found by UID, search by name
        if (!recipe) {
          if (!options.json) {
            console.log("Searching recipes...");
          }
          recipe = await client.findRecipeByName(identifier);
        }

        if (!recipe) {
          printError(`Recipe not found: ${identifier}`);
          process.exit(ExitCode.Failure);
        }

        if (options.json) {
          console.log(JSON.stringify(recipe, null, 2));
        } else if (options.ingredientsOnly) {
          console.log(`\nIngredients for "${recipe.name}":\n`);
          console.log(recipe.ingredients);
        } else {
          printRecipe(recipe);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("import-recipe")
  .description("Import one or more recipes from JSON directly into Paprika cloud sync")
  .argument(
    "<path>",
    "Path to a JSON file containing a recipe object or array of recipe objects"
  )
  .option("--json", "Output as JSON")
  .option("--dry-run", "Validate and prepare uploads without writing to Paprika")
  .option(
    "--allow-duplicate",
    "Create a new recipe even if an exact name match already exists"
  )
  .option(
    "--update-existing",
    "Update the exact-name match instead of creating a duplicate"
  )
  .action(
    async (
      path: string,
      options: {
        json?: boolean;
        dryRun?: boolean;
        allowDuplicate?: boolean;
        updateExisting?: boolean;
      }
    ) => {
      if (options.allowDuplicate && options.updateExisting) {
        printError("Choose either --allow-duplicate or --update-existing, not both.");
        process.exit(ExitCode.InvalidUsage);
      }

      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw) as ImportedRecipeInput | ImportedRecipeInput[];
        const inputRecipes = Array.isArray(parsed) ? parsed : [parsed];
        const categoryMap = buildCategoryMap(await client.getCategories());
        const existingRecipesByName = new Map<string, Recipe[]>();

        if (!options.allowDuplicate || options.updateExisting) {
          if (!options.json) {
            console.log("Fetching existing recipes...");
          }

          const existingRecipes = (await client.getAllRecipes()).filter(
            (recipe) => !recipe.in_trash
          );

          for (const recipe of existingRecipes) {
            const key = recipe.name.trim().toLowerCase();
            const bucket = existingRecipesByName.get(key) ?? [];
            bucket.push(recipe);
            existingRecipesByName.set(key, bucket);
          }
        }

        const results: Array<{
          action: string;
          name: string;
          uid: string;
          categories: string[];
        }> = [];

        for (const input of inputRecipes) {
          const inputName = typeof input.name === "string" ? input.name.trim() : "";
          const matches = inputName
            ? existingRecipesByName.get(inputName.toLowerCase()) ?? []
            : [];

          if (matches.length > 1 && options.updateExisting) {
            throw new Error(
              `Multiple existing recipes named "${inputName}". Refusing ambiguous update.`
            );
          }

          if (matches.length > 0 && !options.allowDuplicate && !options.updateExisting) {
            throw new Error(
              `Recipe already exists: ${inputName}. Use --update-existing or --allow-duplicate.`
            );
          }

          const existingRecipe = options.updateExisting ? (matches[0] ?? null) : null;
          const recipe = normalizeImportedRecipe(input, {
            categoryMap,
            existingRecipe,
          });
          const action = existingRecipe ? "update" : "create";

          if (options.dryRun) {
            results.push({
              action,
              name: recipe.name,
              uid: recipe.uid,
              categories: recipe.categories,
            });
            continue;
          }

          const saved = await client.saveRecipe(recipe);
          results.push({
            action: `${action}d`,
            name: saved.name,
            uid: saved.uid,
            categories: saved.categories,
          });
        }

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 1) {
          const result = results[0]!;
          const verb = options.dryRun
            ? `Would ${result.action}`
            : result.action.charAt(0).toUpperCase() + result.action.slice(1);
          console.log(`${verb} recipe: ${style.bold(result.name)} (${result.uid})`);
        } else {
          const verb = options.dryRun ? "Would import" : "Imported";
          console.log(`${verb} ${results.length} recipes:`);
          for (const result of results) {
            console.log(`• ${result.action}: ${style.bold(result.name)} (${result.uid})`);
          }
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("update-recipe")
  .description("Update an existing recipe from a JSON file")
  .argument("<identifier>", "Recipe UID or name")
  .argument("<path>", "Path to a JSON file containing one recipe object")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Validate and prepare the update without writing to Paprika")
  .action(
    async (
      identifier: string,
      path: string,
      options: { json?: boolean; dryRun?: boolean }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const existingRecipe = await resolveRecipeIdentifier(client, identifier, {
          includeTrash: true,
        });

        if (!existingRecipe) {
          throw new Error(`Recipe not found: ${identifier}`);
        }

        const input = readSingleImportedRecipe(path);
        const categoryMap = buildCategoryMap(await client.getCategories());
        const recipe = normalizeImportedRecipe(input, {
          categoryMap,
          existingRecipe,
        });

        if (options.dryRun) {
          const result = {
            action: "update",
            uid: recipe.uid,
            name: recipe.name,
            categories: recipe.categories,
            in_trash: recipe.in_trash,
            is_pinned: recipe.is_pinned,
            on_favorites: recipe.on_favorites,
          };
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Would update recipe: ${style.bold(recipe.name)} (${recipe.uid})`);
          }
          return;
        }

        const saved = await client.saveRecipe(recipe);
        if (options.json) {
          console.log(JSON.stringify(saved, null, 2));
        } else {
          console.log(`Updated recipe: ${style.bold(saved.name)} (${saved.uid})`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("trash-recipe")
  .description("Move a recipe to the Paprika trash")
  .argument("<identifier>", "Recipe UID or name")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(async (identifier: string, options: { json?: boolean; dryRun?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const existingRecipe = await resolveRecipeIdentifier(client, identifier, {
        includeTrash: true,
      });
      if (!existingRecipe) {
        throw new Error(`Recipe not found: ${identifier}`);
      }
      if (existingRecipe.in_trash) {
        throw new Error(`Recipe is already in trash: ${existingRecipe.name}`);
      }

      const recipe = normalizeImportedRecipe({ in_trash: true }, {
        categoryMap: buildCategoryMap(await client.getCategories()),
        existingRecipe,
      });

      if (options.dryRun) {
        const result = { action: "trash", uid: recipe.uid, name: recipe.name, in_trash: true };
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Would trash recipe: ${style.bold(recipe.name)} (${recipe.uid})`);
        }
        return;
      }

      const saved = await client.saveRecipe(recipe);
      if (options.json) {
        console.log(JSON.stringify(saved, null, 2));
      } else {
        console.log(`Trashed recipe: ${style.bold(saved.name)} (${saved.uid})`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("restore-recipe")
  .description("Restore a trashed recipe")
  .argument("<identifier>", "Recipe UID or name")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(async (identifier: string, options: { json?: boolean; dryRun?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const existingRecipe = await resolveRecipeIdentifier(client, identifier, {
        includeTrash: true,
      });
      if (!existingRecipe) {
        throw new Error(`Recipe not found: ${identifier}`);
      }
      if (!existingRecipe.in_trash) {
        throw new Error(`Recipe is not in trash: ${existingRecipe.name}`);
      }

      const recipe = normalizeImportedRecipe({ in_trash: false }, {
        categoryMap: buildCategoryMap(await client.getCategories()),
        existingRecipe,
      });

      if (options.dryRun) {
        const result = { action: "restore", uid: recipe.uid, name: recipe.name, in_trash: false };
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Would restore recipe: ${style.bold(recipe.name)} (${recipe.uid})`);
        }
        return;
      }

      const saved = await client.saveRecipe(recipe);
      if (options.json) {
        console.log(JSON.stringify(saved, null, 2));
      } else {
        console.log(`Restored recipe: ${style.bold(saved.name)} (${saved.uid})`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("favorite-recipe")
  .description("Toggle a recipe's favorite flag")
  .argument("<identifier>", "Recipe UID or name")
  .option("--json", "Output as JSON")
  .option("--remove", "Clear the favorite flag instead of setting it")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(
    async (
      identifier: string,
      options: { json?: boolean; remove?: boolean; dryRun?: boolean }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const existingRecipe = await resolveRecipeIdentifier(client, identifier, {
          includeTrash: true,
        });
        if (!existingRecipe) {
          throw new Error(`Recipe not found: ${identifier}`);
        }

        const enabled = !options.remove;
        const recipe = normalizeImportedRecipe({ on_favorites: enabled }, {
          categoryMap: buildCategoryMap(await client.getCategories()),
          existingRecipe,
        });

        if (options.dryRun) {
          const result = {
            action: enabled ? "favorite" : "unfavorite",
            uid: recipe.uid,
            name: recipe.name,
            on_favorites: recipe.on_favorites,
          };
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const verb = enabled ? "favorite" : "unfavorite";
            console.log(`Would ${verb} recipe: ${style.bold(recipe.name)} (${recipe.uid})`);
          }
          return;
        }

        const saved = await client.saveRecipe(recipe);
        if (options.json) {
          console.log(JSON.stringify(saved, null, 2));
        } else {
          const verb = enabled ? "Favorited" : "Unfavorited";
          console.log(`${verb} recipe: ${style.bold(saved.name)} (${saved.uid})`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("pin-recipe")
  .description("Toggle a recipe's pinned flag")
  .argument("<identifier>", "Recipe UID or name")
  .option("--json", "Output as JSON")
  .option("--remove", "Clear the pinned flag instead of setting it")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(
    async (
      identifier: string,
      options: { json?: boolean; remove?: boolean; dryRun?: boolean }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const existingRecipe = await resolveRecipeIdentifier(client, identifier, {
          includeTrash: true,
        });
        if (!existingRecipe) {
          throw new Error(`Recipe not found: ${identifier}`);
        }

        const enabled = !options.remove;
        const recipe = normalizeImportedRecipe({ is_pinned: enabled }, {
          categoryMap: buildCategoryMap(await client.getCategories()),
          existingRecipe,
        });

        if (options.dryRun) {
          const result = {
            action: enabled ? "pin" : "unpin",
            uid: recipe.uid,
            name: recipe.name,
            is_pinned: recipe.is_pinned,
          };
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const verb = enabled ? "pin" : "unpin";
            console.log(`Would ${verb} recipe: ${style.bold(recipe.name)} (${recipe.uid})`);
          }
          return;
        }

        const saved = await client.saveRecipe(recipe);
        if (options.json) {
          console.log(JSON.stringify(saved, null, 2));
        } else {
          const verb = enabled ? "Pinned" : "Unpinned";
          console.log(`${verb} recipe: ${style.bold(saved.name)} (${saved.uid})`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("search")
  .description("Search recipes by name or description")
  .argument("<query>", "Search query")
  .option("--json", "Output as JSON")
  .action(async (query: string, options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      if (!options.json) {
        console.log("Searching recipes...");
      }
      const recipes = await client.searchRecipes(query);
      const active = recipes.filter((r) => !r.in_trash);

      if (options.json) {
        console.log(JSON.stringify(active, null, 2));
      } else if (active.length === 0) {
        console.log(`No recipes found matching "${query}"`);
      } else {
        console.log(`\nFound ${active.length} recipes matching "${query}":\n`);
        for (const recipe of active) {
          console.log(`• ${style.bold(recipe.name)}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Meal Plan Commands
// ============================================

program
  .command("meals")
  .description("Show meal plan")
  .option("--json", "Output as JSON")
  .option("--date <date>", "Filter by date (YYYY-MM-DD)")
  .action(async (options: { json?: boolean; date?: string }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      let meals = await client.getMeals();
      const mealTypes = await client.getMealTypes();

      if (options.date) {
        meals = meals.filter((meal) => getMealDateKey(meal.date) === options.date);
      }

      if (options.json) {
        console.log(JSON.stringify(meals, null, 2));
      } else if (meals.length === 0) {
        console.log("No meals planned.");
      } else {
        const mealTypeNames = new Map<string, string>();
        for (const mealType of mealTypes) {
          mealTypeNames.set(`uid:${mealType.uid}`, mealType.name);
          mealTypeNames.set(`type:${mealType.original_type}`, mealType.name);
        }

        const byDate = new Map<string, Meal[]>();
        for (const meal of meals) {
          const dateKey = getMealDateKey(meal.date);
          const existing = byDate.get(dateKey) ?? [];
          existing.push(meal);
          byDate.set(dateKey, existing);
        }

        for (const [date, dateMeals] of [...byDate.entries()].sort()) {
          console.log(`\n${style.bold(date)}:`);
          for (const meal of dateMeals.sort((a, b) => a.type - b.type || a.order_flag - b.order_flag)) {
            const type =
              (meal.type_uid ? mealTypeNames.get(`uid:${meal.type_uid}`) : undefined) ??
              mealTypeNames.get(`type:${meal.type}`) ??
              "Other";
            console.log(
              `  ${style.dim(type + ":")} ${meal.name} ${style.dim("[" + meal.uid + "]")}`
            );
          }
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("add-meal")
  .description("Add a meal plan entry")
  .argument("<date>", "Meal date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)")
  .argument("<mealType>", "Meal type name or number")
  .argument("[name]", "Meal name when not linking directly to a recipe")
  .option("--recipe <identifier>", "Recipe UID or name to link")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(
    async (
      date: string,
      mealType: string,
      name: string | undefined,
      options: { recipe?: string; json?: boolean; dryRun?: boolean }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const normalizedDate = normalizeMealDate(date);
        const resolvedMealType = await resolveMealType(client, mealType);
        const meals = await client.getMeals();
        const recipe = options.recipe
          ? await resolveRecipeIdentifier(client, options.recipe)
          : null;

        if (options.recipe && !recipe) {
          throw new Error(`Recipe not found: ${options.recipe}`);
        }

        const mealName = name?.trim() || recipe?.name;
        if (!mealName) {
          throw new Error("Meal name is required unless --recipe resolves to an existing recipe.");
        }

        const orderFlag = getNextMealOrderFlag(
          meals,
          normalizedDate,
          resolvedMealType.original_type
        );

        const payload: MealWritePayload = {
          uid: randomUUID().toUpperCase(),
          recipe_uid: recipe?.uid ?? null,
          name: mealName,
          date: normalizedDate,
          type: resolvedMealType.original_type,
          order_flag: orderFlag,
          hash: generateSyncHash(),
          deleted: false,
        };

        if (options.dryRun) {
          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(`Would add meal: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
          }
          return;
        }

        await client.saveMeals([payload]);
        const createdMeal = findMealByUid(await client.getMeals(), payload.uid);
        if (!createdMeal) {
          throw new Error("Meal was created but could not be reloaded from Paprika.");
        }

        if (options.json) {
          console.log(JSON.stringify(createdMeal, null, 2));
        } else {
          console.log(`Added meal: ${style.bold(createdMeal.name)} ${style.dim("[" + createdMeal.uid + "]")}`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("update-meal")
  .description("Update an existing meal plan entry")
  .argument("<uid>", "Meal UID")
  .option("--date <date>", "New date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)")
  .option("--type <mealType>", "New meal type name or number")
  .option("--name <name>", "New meal name")
  .option("--recipe <identifier>", "Recipe UID or name to link")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(
    async (
      uid: string,
      options: {
        date?: string;
        type?: string;
        name?: string;
        recipe?: string;
        json?: boolean;
        dryRun?: boolean;
      }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const meals = await client.getMeals();
        const existingMeal = findMealByUid(meals, uid);
        if (!existingMeal) {
          throw new Error(`Meal not found: ${uid}`);
        }
        if (!options.date && !options.type && !options.name && !options.recipe) {
          throw new Error("Provide at least one of --date, --type, --name, or --recipe.");
        }

        const resolvedMealType = options.type
          ? await resolveMealType(client, options.type)
          : null;
        const recipe = options.recipe
          ? await resolveRecipeIdentifier(client, options.recipe)
          : null;
        if (options.recipe && !recipe) {
          throw new Error(`Recipe not found: ${options.recipe}`);
        }

        const nextDate = options.date ? normalizeMealDate(options.date) : existingMeal.date;
        const nextType = resolvedMealType?.original_type ?? existingMeal.type;
        const typeOrDateChanged =
          nextDate !== existingMeal.date || nextType !== existingMeal.type;

        const payload = toMealWritePayload(existingMeal, {
          date: nextDate,
          type: nextType,
          name: options.name?.trim() || recipe?.name || existingMeal.name,
          recipe_uid: options.recipe ? (recipe?.uid ?? null) : existingMeal.recipe_uid,
          order_flag: typeOrDateChanged
            ? getNextMealOrderFlag(meals, nextDate, nextType, existingMeal.uid)
            : existingMeal.order_flag,
        });

        if (options.dryRun) {
          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(`Would update meal: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
          }
          return;
        }

        await client.saveMeals([payload]);
        const updatedMeal = findMealByUid(await client.getMeals(), payload.uid);
        if (!updatedMeal) {
          throw new Error("Meal was updated but could not be reloaded from Paprika.");
        }

        if (options.json) {
          console.log(JSON.stringify(updatedMeal, null, 2));
        } else {
          console.log(`Updated meal: ${style.bold(updatedMeal.name)} ${style.dim("[" + updatedMeal.uid + "]")}`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("remove-meal")
  .description("Remove a meal plan entry")
  .argument("<uid>", "Meal UID")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(async (uid: string, options: { json?: boolean; dryRun?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const meals = await client.getMeals();
      const existingMeal = findMealByUid(meals, uid);
      if (!existingMeal) {
        throw new Error(`Meal not found: ${uid}`);
      }

      const payload = toMealWritePayload(existingMeal, { deleted: true });

      if (options.dryRun) {
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`Would remove meal: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
        }
        return;
      }

      await client.saveMeals([payload]);
      const deletedMeal = findMealByUid(await client.getMeals(), payload.uid);
      if (deletedMeal) {
        throw new Error("Meal still exists after delete request.");
      }

      if (options.json) {
        console.log(JSON.stringify({ removed: true, uid: payload.uid, name: payload.name }, null, 2));
      } else {
        console.log(`Removed meal: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("menus")
  .description("List Paprika menus")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const menus = await client.getMenus();

      if (options.json) {
        console.log(JSON.stringify(menus, null, 2));
      } else if (menus.length === 0) {
        console.log("No menus found.");
      } else {
        console.log(`\nMenus (${menus.length}):\n`);
        for (const menu of menus.sort((a, b) => a.name.localeCompare(b.name))) {
          console.log(`• ${style.bold(menu.name)}`);
          if (menu.notes) {
            console.log(`  ${style.dim(menu.notes)}`);
          }
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("menuitems")
  .description("List Paprika menu items")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const menuItems = await client.getMenuItems();

      if (options.json) {
        console.log(JSON.stringify(menuItems, null, 2));
      } else if (menuItems.length === 0) {
        console.log("No menu items found.");
      } else {
        console.log(`\nMenu items (${menuItems.length}):\n`);
        for (const item of menuItems.sort((a, b) => a.order_flag - b.order_flag)) {
          const recipeSuffix = item.recipe_uid ? style.dim(` [${item.recipe_uid}]`) : "";
          const menuSuffix = item.menu_uid ? style.dim(` → ${item.menu_uid}`) : "";
          console.log(`• ${style.bold(item.name)}${recipeSuffix}${menuSuffix}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Grocery Commands
// ============================================

program
  .command("groceries")
  .description("Show grocery list")
  .option("--json", "Output as JSON")
  .option("--all", "Include purchased items")
  .action(async (options: { json?: boolean; all?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const items = await client.getGroceries();
      const filtered = options.all ? items : items.filter((i) => !i.purchased);

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else if (filtered.length === 0) {
        console.log("Grocery list is empty.");
      } else {
        const byAisle = new Map<string, typeof items>();
        for (const item of filtered) {
          const aisle = item.aisle || "Uncategorized";
          const existing = byAisle.get(aisle) ?? [];
          existing.push(item);
          byAisle.set(aisle, existing);
        }

        console.log(`\nGrocery list (${filtered.length} items):\n`);
        for (const [aisle, aisleItems] of [...byAisle.entries()].sort()) {
          console.log(`${style.bold(aisle)}:`);
          for (const item of aisleItems.sort((a, b) => a.order_flag - b.order_flag)) {
            const qty = item.quantity ? `${item.quantity} ` : "";
            const purchased = item.purchased ? style.dim(" ✓") : "";
            console.log(
              `  • ${qty}${item.name}${purchased} ${style.dim("[" + item.uid + "]")}`
            );
          }
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("add-grocery")
  .description("Add a grocery list item")
  .argument("<name>", "Grocery item name")
  .argument("[quantity]", "Optional quantity")
  .option("--aisle <identifier>", "Grocery aisle name or UID")
  .option("--ingredient <ingredient>", "Ingredient name override")
  .option("--instruction <instruction>", "Instruction/note text")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(
    async (
      name: string,
      quantity: string | undefined,
      options: {
        aisle?: string;
        ingredient?: string;
        instruction?: string;
        json?: boolean;
        dryRun?: boolean;
      }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const [items, list, aisle] = await Promise.all([
          client.getGroceries(),
          getDefaultGroceryList(client),
          resolveGroceryAisle(client, options.aisle),
        ]);

        const payload: GroceryWritePayload = {
          uid: randomUUID().toUpperCase(),
          name: name.trim(),
          ingredient: options.ingredient?.trim() || name.trim(),
          recipe_uid: null,
          recipe: null,
          instruction: options.instruction?.trim() || "",
          quantity: quantity?.trim() || "",
          purchased: false,
          order_flag: getNextGroceryOrderFlag(items, list.uid),
          separate: false,
          aisle: aisle?.name ?? "",
          aisle_uid: aisle?.uid ?? null,
          list_uid: list.uid,
          hash: generateSyncHash(),
          deleted: false,
        };

        if (options.dryRun) {
          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(`Would add grocery: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
          }
          return;
        }

        await client.saveGroceries([payload]);
        const createdItem = findGroceryByUid(await client.getGroceries(), payload.uid);
        if (!createdItem) {
          throw new Error("Grocery item was created but could not be reloaded from Paprika.");
        }

        if (options.json) {
          console.log(JSON.stringify(createdItem, null, 2));
        } else {
          console.log(`Added grocery: ${style.bold(createdItem.name)} ${style.dim("[" + createdItem.uid + "]")}`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("update-grocery")
  .description("Update a grocery list item")
  .argument("<uid>", "Grocery item UID")
  .option("--name <name>", "New grocery item name")
  .option("--quantity <quantity>", "New quantity")
  .option("--aisle <identifier>", "New aisle name or UID")
  .option("--ingredient <ingredient>", "New ingredient text")
  .option("--instruction <instruction>", "New instruction/note text")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(
    async (
      uid: string,
      options: {
        name?: string;
        quantity?: string;
        aisle?: string;
        ingredient?: string;
        instruction?: string;
        json?: boolean;
        dryRun?: boolean;
      }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const items = await client.getGroceries();
        const existingItem = findGroceryByUid(items, uid);
        if (!existingItem) {
          throw new Error(`Grocery item not found: ${uid}`);
        }
        if (
          !options.name &&
          options.quantity === undefined &&
          options.aisle === undefined &&
          options.ingredient === undefined &&
          options.instruction === undefined
        ) {
          throw new Error(
            "Provide at least one of --name, --quantity, --aisle, --ingredient, or --instruction."
          );
        }

        const aisle = options.aisle !== undefined
          ? await resolveGroceryAisle(client, options.aisle)
          : null;

        const payload = toGroceryWritePayload(existingItem, {
          name: options.name?.trim() || existingItem.name,
          quantity: options.quantity !== undefined ? options.quantity.trim() : existingItem.quantity,
          ingredient:
            options.ingredient !== undefined
              ? options.ingredient.trim()
              : existingItem.ingredient,
          instruction:
            options.instruction !== undefined
              ? options.instruction.trim()
              : existingItem.instruction ?? "",
          aisle: options.aisle !== undefined ? aisle?.name ?? "" : existingItem.aisle,
          aisle_uid:
            options.aisle !== undefined
              ? aisle?.uid ?? null
              : existingItem.aisle_uid ?? null,
        });

        if (options.dryRun) {
          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(`Would update grocery: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
          }
          return;
        }

        await client.saveGroceries([payload]);
        const updatedItem = findGroceryByUid(await client.getGroceries(), payload.uid);
        if (!updatedItem) {
          throw new Error("Grocery item was updated but could not be reloaded from Paprika.");
        }

        if (options.json) {
          console.log(JSON.stringify(updatedItem, null, 2));
        } else {
          console.log(`Updated grocery: ${style.bold(updatedItem.name)} ${style.dim("[" + updatedItem.uid + "]")}`);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("check-grocery")
  .description("Mark a grocery item as purchased")
  .argument("<uid>", "Grocery item UID")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(async (uid: string, options: { json?: boolean; dryRun?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const existingItem = findGroceryByUid(await client.getGroceries(), uid);
      if (!existingItem) {
        throw new Error(`Grocery item not found: ${uid}`);
      }
      if (existingItem.purchased) {
        throw new Error(`Grocery item is already purchased: ${uid}`);
      }

      const payload = toGroceryWritePayload(existingItem, { purchased: true });

      if (options.dryRun) {
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`Would check grocery: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
        }
        return;
      }

      await client.saveGroceries([payload]);
      const checkedItem = findGroceryByUid(await client.getGroceries(), payload.uid);
      if (!checkedItem) {
        throw new Error("Grocery item was updated but could not be reloaded from Paprika.");
      }
      if (!checkedItem.purchased) {
        throw new Error("Grocery item did not report purchased=true after update.");
      }

      if (options.json) {
        console.log(JSON.stringify(checkedItem, null, 2));
      } else {
        console.log(`Checked grocery: ${style.bold(checkedItem.name)} ${style.dim("[" + checkedItem.uid + "]")}`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("uncheck-grocery")
  .description("Mark a grocery item as not purchased")
  .argument("<uid>", "Grocery item UID")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(async (uid: string, options: { json?: boolean; dryRun?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const existingItem = findGroceryByUid(await client.getGroceries(), uid);
      if (!existingItem) {
        throw new Error(`Grocery item not found: ${uid}`);
      }
      if (!existingItem.purchased) {
        throw new Error(`Grocery item is already unchecked: ${uid}`);
      }

      const payload = toGroceryWritePayload(existingItem, { purchased: false });

      if (options.dryRun) {
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`Would uncheck grocery: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
        }
        return;
      }

      await client.saveGroceries([payload]);
      const uncheckedItem = findGroceryByUid(await client.getGroceries(), payload.uid);
      if (!uncheckedItem) {
        throw new Error("Grocery item was updated but could not be reloaded from Paprika.");
      }
      if (uncheckedItem.purchased) {
        throw new Error("Grocery item still reports purchased=true after update.");
      }

      if (options.json) {
        console.log(JSON.stringify(uncheckedItem, null, 2));
      } else {
        console.log(`Unchecked grocery: ${style.bold(uncheckedItem.name)} ${style.dim("[" + uncheckedItem.uid + "]")}`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("remove-grocery")
  .description("Remove a grocery list item")
  .argument("<uid>", "Grocery item UID")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show the change without writing to Paprika")
  .action(async (uid: string, options: { json?: boolean; dryRun?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const existingItem = findGroceryByUid(await client.getGroceries(), uid);
      if (!existingItem) {
        throw new Error(`Grocery item not found: ${uid}`);
      }

      const payload = toGroceryWritePayload(existingItem, { deleted: true });

      if (options.dryRun) {
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`Would remove grocery: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
        }
        return;
      }

      await client.saveGroceries([payload]);
      const deletedItem = findGroceryByUid(await client.getGroceries(), payload.uid);
      if (deletedItem) {
        throw new Error("Grocery item still exists after delete request.");
      }

      if (options.json) {
        console.log(JSON.stringify({ removed: true, uid: payload.uid, name: payload.name }, null, 2));
      } else {
        console.log(`Removed grocery: ${style.bold(payload.name)} ${style.dim("[" + payload.uid + "]")}`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

program
  .command("pantry")
  .description("List pantry items")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const items = await client.getPantry();

      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
      } else if (items.length === 0) {
        console.log("Pantry is empty.");
      } else {
        const byAisle = new Map<string, PantryItem[]>();
        for (const item of items) {
          const aisle = item.aisle || "Uncategorized";
          const existing = byAisle.get(aisle) ?? [];
          existing.push(item);
          byAisle.set(aisle, existing);
        }

        console.log(`\nPantry (${items.length} items):\n`);
        for (const [aisle, aisleItems] of [...byAisle.entries()].sort()) {
          console.log(`${style.bold(aisle)}:`);
          for (const item of aisleItems.sort((a, b) =>
            a.ingredient.localeCompare(b.ingredient)
          )) {
            const qty = item.quantity ? ` (${item.quantity})` : "";
            const stock = item.in_stock === false ? style.dim(" [out of stock]") : "";
            console.log(`  • ${item.ingredient}${qty}${stock}`);
          }
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Category Commands
// ============================================

program
  .command("categories")
  .description("List recipe categories")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const categories = await client.getCategories();

      if (options.json) {
        console.log(JSON.stringify(categories, null, 2));
      } else {
        console.log("\nCategories:\n");
        for (const cat of categories.sort((a, b) =>
          a.name.localeCompare(b.name)
        )) {
          console.log(`• ${cat.name}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Helper Functions
// ============================================

function printRecipe(recipe: Recipe): void {
  console.log(`\n${"=".repeat(50)}`);
  console.log(style.bold(recipe.name));
  console.log("=".repeat(50));

  if (recipe.description) {
    console.log(`\n${recipe.description}`);
  }

  const meta: string[] = [];
  if (recipe.prep_time) meta.push(`Prep: ${recipe.prep_time}`);
  if (recipe.cook_time) meta.push(`Cook: ${recipe.cook_time}`);
  if (recipe.total_time) meta.push(`Total: ${recipe.total_time}`);
  if (recipe.servings) meta.push(`Servings: ${recipe.servings}`);
  if (recipe.difficulty) meta.push(`Difficulty: ${recipe.difficulty}`);
  if (recipe.rating > 0) meta.push(`Rating: ${recipe.rating}★`);

  if (meta.length > 0) {
    console.log(`\n${style.dim(meta.join(" | "))}`);
  }

  if (recipe.source) {
    console.log(`\n${style.dim("Source:")} ${recipe.source}`);
    if (recipe.source_url) {
      console.log(`${style.dim("URL:")} ${recipe.source_url}`);
    }
  }

  if (recipe.ingredients) {
    console.log(`\n${style.bold("--- Ingredients ---")}`);
    console.log(recipe.ingredients);
  }

  if (recipe.directions) {
    console.log(`\n${style.bold("--- Directions ---")}`);
    console.log(recipe.directions);
  }

  if (recipe.notes) {
    console.log(`\n${style.bold("--- Notes ---")}`);
    console.log(recipe.notes);
  }

  if (recipe.nutritional_info) {
    console.log(`\n${style.bold("--- Nutrition ---")}`);
    console.log(recipe.nutritional_info);
  }

  console.log("");
}

program.parse();
