const text = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const record = (properties, required = []) => ({
  type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false
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
    items: list(record({ name: text, amount: text }, ['name']), 40)
  }, ['items']), 12),
  stages: list(record({
    title: text,
    timing: text,
    ingredients: list(text, 40),
    steps: list(text, 25),
    notes: list(text, 12),
    isSide: boolean
  }, ['steps']), 24),
  schedule: list(record({
    label: text,
    stage: integer,
    offsets: list(integer, 2)
  }), 40)
}, ['kind']);

// Keep local bounds separate from Gemini's constrained-decoding grammar.
function forGemini(schema) {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, field]) => [name, forGemini(field)])
    );
    return { ...schema, properties, required: Object.keys(properties) };
  }
  if (schema.type === 'array') return { type: 'array', items: forGemini(schema.items) };
  return schema;
}

export const geminiSchema = forGemini(extractionSchema);

// Accept omitted optional fields while checking types, limits and unknown fields.
function matches(value, schema) {
  switch (schema.type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        (schema.required ?? []).every((key) => Object.hasOwn(value, key)) &&
        Object.entries(value).every(([key, field]) =>
          Object.hasOwn(schema.properties, key) && matches(field, schema.properties[key]));
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

const nonempty = (values = []) => values.map((value) => value.trim()).filter(Boolean);

export function normalizeRecipe(extracted) {
  if (!matches(extracted, extractionSchema)) throw new TypeError('Invalid extraction schema');
  if (extracted.kind !== 'recipe') throw new RecipeError('No usable food recipe was found.');
  const { title: sourceTitle = '', stages = [], shopping = [], schedule = [] } = extracted;
  const title = sourceTitle.trim().slice(0, 100) || 'Untitled recipe';
  if (!stages.length) throw new RecipeError('Add at least one cooking stage with steps.');

  const cards = stages.map((stage, index) => {
    const stageTitle = stage.title?.trim() || 'Stage ' + (index + 1);
    const steps = nonempty(stage.steps);
    if (!steps.length) throw new TypeError('Empty cooking stage');
    return {
      id: 'stage-' + (index + 1),
      title: stageTitle,
      timing: stage.timing?.trim() ?? '',
      ingredients: nonempty(stage.ingredients),
      steps,
      notes: nonempty(stage.notes)
    };
  });
  const shoppingList = shopping.map((group, groupIndex) => ({
    name: group.category?.trim() || 'Ingredients',
    items: (group.items ?? []).map((item, itemIndex) => ({
      id: groupIndex + '-' + itemIndex,
      name: item.name.trim(),
      amount: item.amount?.trim() ?? ''
    })).filter((item) => item.name)
  })).filter((group) => group.name && group.items.length);
  const reviewNotes = nonempty(extracted.reviewNotes);
  const timeline = [];
  let omittedTiming = false;
  for (const { label = '', stage, offsets = [] } of schedule) {
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
    summary: extracted.summary?.trim() ?? '',
    servings: extracted.servings?.trim() ?? '',
    prep: extracted.prep?.trim() ?? '',
    cook: extracted.cook?.trim() ?? '',
    defaultDinner: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(extracted.dinnerTime) ? extracted.dinnerTime : '18:00',
    shoppingList,
    cards,
    timeline,
    sideIds: cards.filter((_, index) => stages[index].isSide).map((card) => card.id),
    safety: extracted.safety?.trim() ?? '',
    reviewNotes: [...new Set(reviewNotes)]
  };
}
