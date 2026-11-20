# Shake and Bake

A phone-friendly cooking app with a shopping checklist, dinner timeline, and step-by-step recipe cards. GitHub Pages serves the static frontend from the **main** branch and **/docs** folder.

## Recipe storage

Personal drafts and AI imports stay in this browser's site storage. The original text stays attached to each personal import. Open an entry in **My recipes** and choose **Remove** to delete its copy from this browser.

## Public recipes

Repository collaborators manage the public shelf through [the recipes folder](https://github.com/Iisakkahkonen/shake-and-bake/tree/main/docs/recipes).

- To publish a reviewed recipe, open its cooking cards and choose **Download recipe JSON**. Commit the exported file under **docs/recipes/** using its filename. Add its **id**, **title**, and **summary** to **docs/recipes/index.json** to list it on Home. The export contains the normalized recipe. You can share the direct link with **?recipe=RECIPE-ID**.
- To remove a recipe from the public site, remove its entry from **docs/recipes/index.json** and delete its matching recipe JSON in the same commit. Once GitHub Pages redeploys, its direct link stops working. Earlier commits in the public repository retain the file.

The built-in **docs/recipes/fried-chicken-factory.json** is the first example of the versioned recipe format.

## Set up Gemini conversion

1. Deploy **parser/** as a Cloudflare Worker using **parser/wrangler.jsonc** and the current Wrangler CLI. The Worker expects **GEMINI_API_KEY** and **RECIPE_IMPORT_CODE** as encrypted Worker secrets. Use a separate random import code of 32–128 URL-safe characters. For example, generate one with **node -p "require('node:crypto').randomBytes(24).toString('base64url')"**. Add both secrets in the Cloudflare dashboard or use Wrangler's secret upload options with a gitignored file.
2. Verify **APP_ORIGIN** is the exact frontend origin, with no path or trailing slash. The default is the current GitHub Pages origin. The configured Cloudflare rate limit is five authenticated requests per minute per Cloudflare location. Gemini also enforces project quotas.
3. Set the **recipe-parser-endpoint** meta tag in **docs/index.html** to the deployed HTTPS URL ending in **/parse-recipe**, then publish via GitHub Pages. This enables **Make cooking cards** on Home. Enter the separate import code on the page and submit a recipe. The Google key belongs in Worker secrets. For local testing, set **APP_ORIGIN** to the local frontend origin and use local Worker secrets in an ignored **parser/.dev.vars** file.

The API accepts text only. It sends each request to Gemini with a fixed extraction prompt, without tools, and validates the structured reply before returning recipe data. Incomplete fields remain blank or appear as review notes. Review quantities, times, temperatures, and any safety guidance against the source before using or publishing an import. The Worker does not log recipe text or hold GitHub write credentials.

Run the parser tests from the repository root with **node --test parser/worker.test.mjs**. Tests use mocked Gemini responses and need no secrets.

- [Google Gemini structured output](https://aistudio.google.com/docs/structured-output)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
