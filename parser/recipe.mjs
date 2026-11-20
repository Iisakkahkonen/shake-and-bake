const text = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const record = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false
});

export const extractionSchema = record({
  kind: { ...text, enum: ['recipe', 'unusable'] },
  title: text,
  summary: text,
  servings: text,
  prep: text,
  cook: text,
  dinnerTime: text,
  safety: text,
  reviewNotes: list(text, 12),
  shopping: list(record({
    category: text,
    items: list(record({ name: text, amount: text }), 40)
  }), 12),
  stages: list(record({
    title: text,
    timing: text,
    ingredients: list(text, 40),
    steps: list(text, 25),
    notes: list(text, 12),
    isSide: boolean
  }), 24),
  schedule: list(record({
    label: text,
    stage: integer,
    offsets: list(integer, 2)
  }), 40)
});

// Check the small schema subset used above again at the trust boundary.
function matches(value, schema) {
  switch (schema.type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === schema.required.length &&
        schema.required.every((key) => Object.hasOwn(value, key) && matches(value[key], schema.properties[key]));
    case 'array':
      return Array.isArray(value) && value.length <= schema.maxItems &&
        value.every((item) => matches(item, schema.items));
    case 'string':
      return typeof value === 'string' && value.length <= 1500 &&
        (!schema.enum || schema.enum.includes(value));
    case 'integer':
      return Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

export class RecipeError extends Error {}

const nonempty = (values) => values.map((value) => value.trim()).filter(Boolean);

export function normalizeRecipe(extracted) {
  if (!matches(extracted, extractionSchema)) throw new TypeError('Invalid extraction schema');
  if (extracted.kind !== 'recipe') throw new RecipeError('No usable food recipe was found.');
  const title = extracted.title.trim().slice(0, 100);
  if (!title || !extracted.stages.length) throw new RecipeError('A recipe needs a title and at least one cooking stage.');

  const cards = extracted.stages.map((stage, index) => {
    const stageTitle = stage.title.trim();
    const steps = nonempty(stage.steps);
    if (!stageTitle || !steps.length) throw new TypeError('Empty cooking stage');
    return {
      id: 'stage-' + (index + 1),
      title: stageTitle,
      timing: stage.timing.trim(),
      ingredients: nonempty(stage.ingredients),
      steps,
      notes: nonempty(stage.notes)
    };
  });
  const shoppingList = extracted.shopping.map((group, groupIndex) => ({
    name: group.category.trim(),
    items: group.items.map((item, itemIndex) => ({
      id: groupIndex + '-' + itemIndex,
      name: item.name.trim(),
      amount: item.amount.trim()
    })).filter((item) => item.name)
  })).filter((group) => group.name && group.items.length);
  const reviewNotes = nonempty(extracted.reviewNotes);
  const timeline = [];
  let omittedTiming = false;
  for (const { label, stage, offsets } of extracted.schedule) {
    const card = cards[stage - 1];
    if (!label.trim() || !card || !offsets.length ||
      offsets.some((offset) => offset < -10080 || offset > 1440) || offsets[0] > offsets.at(-1)) {
      omittedTiming = true;
      continue;
    }
    timeline.push({ label: label.trim(), cardId: card.id, offsets });
  }
  timeline.sort((a, b) => a.offsets[0] - b.offsets[0]);
  if (omittedTiming) {
    reviewNotes.push('Some timetable entries could not be matched to a cooking stage or had invalid times. Check the source before using the timetable.');
  }
  if (!shoppingList.length) reviewNotes.push('The source did not provide a usable shopping list.');
  if (!timeline.length) reviewNotes.push('The source did not give enough timing information for a timetable.');
  if (shoppingList.some((group) => group.items.some((item) => !item.amount))) {
    reviewNotes.push('Some ingredient quantities were missing from the source.');
  }
  const slug = title.normalize('NFKD').toLowerCase().replace(/\p{Mark}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 42).replace(/^-+|-+$/g, '') || 'recipe';
  return {
    schemaVersion: 1,
    id: slug + '-' + crypto.randomUUID().slice(0, 12),
    title,
    summary: extracted.summary.trim(),
    servings: extracted.servings.trim(),
    prep: extracted.prep.trim(),
    cook: extracted.cook.trim(),
    defaultDinner: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(extracted.dinnerTime) ? extracted.dinnerTime : '18:00',
    shoppingList,
    cards,
    timeline,
    sideIds: cards.filter((_, index) => extracted.stages[index].isSide).map((card) => card.id),
    safety: extracted.safety.trim(),
    reviewNotes: [...new Set(reviewNotes)]
  };
}
