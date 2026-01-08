# paprika-recipe-cli

> **⚠️ Unofficial CLI for Paprika Recipe Manager**  
> Not affiliated with or endorsed by Hindsight Labs LLC.

A command-line interface for [Paprika Recipe Manager](https://www.paprikaapp.com). Access your recipes, meal plans, and grocery lists from the terminal.

## Installation

```bash
npm install -g paprika-recipe-cli
```

Or run directly with npx:

```bash
npx paprika-recipe-cli --help
```

## Quick Start

```bash
# Authenticate (interactive)
paprika auth

# List your recipes
paprika recipes

# Search for a recipe
paprika search "chicken"

# View a recipe
paprika recipe "Pasta Carbonara"

# Check your grocery list
paprika groceries
```

## Commands

### Authentication

```bash
paprika auth              # Interactive login
paprika logout            # Clear stored credentials
paprika whoami            # Show current user
```

### Recipes

```bash
paprika recipes                        # List all recipes
paprika recipes --category "Dinner"    # Filter by category
paprika recipes --json                 # Output as JSON

paprika recipe "Pasta Carbonara"       # View by name
paprika recipe <uid>                   # View by UID
paprika recipe "Pasta" --ingredients-only
paprika recipe "Pasta" --json

paprika search "chicken"               # Search recipes
paprika search "quick dinner" --json
```

### Meal Planning

```bash
paprika meals                   # Show all planned meals
paprika meals --date 2026-01-08 # Filter by date
paprika meals --json
```

### Groceries

```bash
paprika groceries        # Show unpurchased items
paprika groceries --all  # Include purchased items
paprika groceries --json
```

### Categories

```bash
paprika categories       # List all categories
paprika categories --json
```

## Options

Global flags available on all commands:

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-V, --version` | Show version number |
| `--no-color` | Disable colored output |
| `--json` | Output as JSON (where applicable) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAPRIKA_EMAIL` | Email for authentication |
| `PAPRIKA_PASSWORD` | Password for authentication |
| `NO_COLOR` | Disable colored output (any value) |

For non-interactive use (scripts, CI/CD), set both `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` environment variables.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Generic failure |
| `2` | Invalid usage (bad arguments) |
| `3` | Authentication failure |

## Examples

### Export all recipes to JSON

```bash
paprika recipes --json > my-recipes.json
```

### Get ingredients for a recipe

```bash
paprika recipe "Spaghetti" --ingredients-only
```

### Script: Check if a recipe exists

```bash
if paprika recipe "Lasagna" --json > /dev/null 2>&1; then
  echo "Recipe found!"
fi
```

### View this week's meal plan

```bash
# Get meals for a specific date
paprika meals --date $(date +%Y-%m-%d)
```

## API Client

This package also exports a TypeScript client for programmatic use:

```typescript
import { PaprikaClient } from 'paprika-recipe-cli';

const client = new PaprikaClient({
  email: process.env.PAPRIKA_EMAIL,
  password: process.env.PAPRIKA_PASSWORD,
});

const recipes = await client.getAllRecipes();
const meals = await client.getMeals();
const groceries = await client.getGroceries();
```

## Development

```bash
git clone https://github.com/mjrussell/paprika-recipe-cli
cd paprika-recipe-cli
npm install
npm run build
node dist/cli.js --help
```

## License

MIT © [Matt Russell](https://github.com/mjrussell)

## Disclaimer

This is an unofficial tool created by the community. Paprika Recipe Manager is a trademark of Hindsight Labs LLC. This project is not affiliated with, endorsed by, or connected to Hindsight Labs LLC in any way.

Requires a Paprika Recipe Manager account with cloud sync enabled.
