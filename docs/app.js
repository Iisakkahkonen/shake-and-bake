const libraryKey = 'shake-and-bake:personal-recipes:v1';
const featuredId = 'fried-chicken-factory';
const recipeLocation = new URLSearchParams(location.search);
const isRecipeLink = recipeLocation.has('local') || recipeLocation.has('recipe');
const parserEndpoint = document.querySelector('meta[name="recipe-parser-endpoint"]')?.content.trim();

function readPersonalRecipes() {
  return JSON.parse(localStorage.getItem(libraryKey) ?? '[]');
}

function usableRecipe(recipe) {
  if (recipe?.schemaVersion !== 1 || typeof recipe.title !== 'string' ||
      typeof recipe.id !== 'string' || !recipe.cards?.length ||
      !Array.isArray(recipe.shoppingList) || !Array.isArray(recipe.timeline) || !Array.isArray(recipe.sideIds)) {
    throw new TypeError('Unsupported recipe data');
  }
  return recipe;
}

function recipeLink(type, id) {
  return location.pathname + '?' + new URLSearchParams({ [type]: id }) + '#shop';
}

function downloadRecipe(recipe) {
  const json = JSON.stringify(recipe, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = recipe.id + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const renderRecipe = (recipe) => {
  const heading = document.querySelector('h1');
  const summary = document.querySelector('.summary');
  const meta = document.querySelector('.meta');
  for (const text of [recipe.servings, recipe.prep, recipe.cook].filter(Boolean)) {
    const item = document.createElement('li');
    item.textContent = text;
    meta.append(item);
  }
  const cards = new Map(recipe.cards.map((card) => [card.id, card]));
  const main = document.querySelector('main');
  const nav = document.querySelector('nav');
  const tabs = ['Home', 'Shop', 'Timeline', 'Cook', 'Sides'];
  const key = `recipe:${recipe.id}:v${recipe.schemaVersion}`;
  const state = { checked: [], dinner: recipe.defaultDinner, stage: recipe.cards[0].id };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved?.checked)) state.checked = saved.checked;
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(saved?.dinner)) state.dinner = saved.dinner;
    if (cards.has(saved?.stage)) state.stage = saved.stage;
  } catch {}
  const checked = new Set(state.checked);
  const shopItems = recipe.shoppingList.flatMap((group) => group.items);
  const store = () => {
    try { localStorage.setItem(key, JSON.stringify({ ...state, checked: [...checked] })); } catch {}
  };

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(options)) {
      if (name === 'text') element.textContent = value;
      else element.setAttribute(name, value);
    }
    element.append(...children);
    return element;
  }
  function button(text, onClick, options = {}) {
    const element = node('button', { type: 'button', text, ...options });
    element.addEventListener('click', onClick);
    return element;
  }
  function title(text) {
    return node('h2', { text, tabindex: '-1' });
  }
  function formatTime(minutes) {
    const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
    return [Math.floor(minuteOfDay / 60), minuteOfDay % 60].map((value) => String(value).padStart(2, '0')).join(':');
  }
  function route(tab, id) {
    const next = '#' + [tab.toLowerCase(), id].filter(Boolean).join('/');
    if (tab === 'Home' && isRecipeLink) location.assign(location.pathname);
    else if (location.hash !== next) location.hash = next;
  }
  function renderShop() {
    if (recipe.reviewNotes?.length) {
      main.append(node('aside', { class: 'card-section' }, [
        node('h3', { text: 'Review before cooking' }),
        node('ul', {}, recipe.reviewNotes.map((text) => node('li', { text })))
      ]));
    }
    if (recipeLocation.has('local')) {
      main.append(node('div', { class: 'actions' }, [
        button('Download recipe JSON', () => downloadRecipe(recipe), { class: 'action' })
      ]));
    }
    if (!shopItems.length) {
      main.append(title('Shopping list'), node('p', { text: 'No shopping list was available in the source.' }));
      return;
    }
    const progress = node('progress', { max: shopItems.length, 'aria-label': 'Shopping progress' });
    const count = node('span', { 'aria-live': 'polite' });
    const update = () => {
      const total = shopItems.filter(({ id }) => checked.has(id)).length;
      progress.value = total;
      count.textContent = `${total} / ${shopItems.length} checked`;
    };
    const inputs = [];
    const groups = recipe.shoppingList.map((group, i) => {
      const rows = group.items.map(({ id, name, amount }) => {
        const input = node('input', { type: 'checkbox' });
        input.checked = checked.has(id);
        inputs.push(input);
        input.addEventListener('change', () => {
          if (input.checked) checked.add(id);
          else checked.delete(id);
          store();
          update();
        });
        return node('li', {}, [node('label', {}, [
          input, node('span', { text: name }), node('span', { class: 'amount', text: amount })
        ])]);
      });
      return node('details', { class: 'box', ...(i < 4 ? { open: '' } : {}) }, [
        node('summary', { text: group.name }), node('ul', { class: 'shop-list' }, rows)
      ]);
    });
    const reset = button('Clear checks', () => {
      checked.clear();
      inputs.forEach((input) => { input.checked = false; });
      store();
      update();
    }, { class: 'action' });
    update();
    main.append(node('div', { class: 'section-head' }, [title('Shopping list'), reset]),
      node('div', { class: 'progress' }, [progress, count]), ...groups);
  }
  function renderTimeline() {
    if (!recipe.timeline.length) {
      main.append(title('Dinner timeline'), node('p', { text: 'The source did not provide enough timing for a timetable.' }));
      return;
    }
    const input = node('input', { type: 'time', value: state.dinner });
    const rows = node('ul', { class: 'box timeline' });
    const update = () => {
      const [hours, minutes] = state.dinner.split(':').map(Number);
      rows.replaceChildren(...recipe.timeline.map(({ offsets, label, cardId }) => {
        const stamps = offsets.map((offset) => hours * 60 + minutes + offset);
        const day = (stamp) => {
          const offset = Math.floor(stamp / 1440);
          if (offset === -1) return 'previous day';
          if (offset === 1) return 'next day';
          if (offset < -1) return -offset + ' days before';
          return offset > 1 ? offset + ' days after' : '';
        };
        const days = [...new Set(stamps.map(day))];
        const buttonLabel = node('span', { class: 'when', text: stamps.map(formatTime).join('–') });
        const dayText = days.filter(Boolean).join(' / ');
        if (dayText) buttonLabel.append(node('small', { class: 'day', text: dayText }));
        const link = button('', () => route('cook', cardId), { class: 'row' });
        link.append(buttonLabel, node('span', { text: label }));
        return node('li', {}, [link]);
      }));
    };
    input.addEventListener('input', () => {
      if (!input.value) return;
      state.dinner = input.value;
      store();
      update();
    });
    update();
    main.append(node('div', { class: 'section-head' }, [title('Dinner timeline')]),
      node('label', { class: 'box time-control' }, [node('span', { text: 'Serve at' }), input]), rows);
  }
  function renderCard(card, actions, status) {
    const section = (heading, tag, list, css) => node('section', { class: 'card-section' }, [
      node('h3', { text: heading }), node(tag, { class: css }, list.map((text) => node('li', { text })))
    ]);
    const heading = node('div', { class: 'section-head' }, [title(card.title)]);
    main.append(heading);
    if (status || card.timing) main.append(node('p', { class: 'muted', text: [status, card.timing].filter(Boolean).join(' · ') }));
    main.append(actions);
    if (card.callout) main.append(node('p', { class: 'callout', text: card.callout }));
    if (card.ingredients.length) main.append(section('Ingredients', 'ul', card.ingredients, 'ingredient-list'));
    main.append(section(card.id === 'assembly' ? 'Set out' : 'Method', card.id === 'assembly' ? 'ul' : 'ol', card.steps, card.id === 'assembly' ? 'ingredient-list' : ''));
    if (card.notes.length) main.append(section('Notes', 'ul', card.notes, 'notes'));
    if (recipe.safety && (recipe.id !== featuredId || card.id === 'marinate' || card.id === 'fry')) {
      main.append(node('p', { class: 'safety', text: recipe.safety }));
    }
  }
  function renderCook(id) {
    const card = cards.get(id) || cards.get(state.stage);
    state.stage = card.id;
    store();
    const index = recipe.cards.indexOf(card);
    const go = (offset) => () => route('cook', recipe.cards[index + offset].id);
    const back = button('Back', go(-1), { class: 'action' });
    const next = button('Next stage', go(1), { class: 'action primary' });
    back.disabled = index === 0;
    next.disabled = index === recipe.cards.length - 1;
    const stage = node('select', { class: 'action', 'aria-label': 'Jump to cooking stage' },
      recipe.cards.map((item) => node('option', { value: item.id, text: item.title })));
    stage.value = card.id;
    stage.addEventListener('change', () => route('cook', stage.value));
    renderCard(card, node('div', { class: 'actions' }, [back, next, stage]), `Stage ${index + 1} of ${recipe.cards.length}`);
  }
  function renderSides(id) {
    if (recipe.sideIds.includes(id)) {
      renderCard(cards.get(id), node('div', { class: 'actions' }, [
        button('All sides', () => route('sides'), { class: 'action' })
      ]));
      return;
    }
    const entries = recipe.sideIds.map((cardId) => {
      const card = cards.get(cardId);
      const link = button('', () => route('sides', card.id), { class: 'row' });
      link.append(node('span', { text: card.title }));
      return node('li', {}, [link]);
    });
    main.append(node('div', { class: 'section-head' }, [title('Sides & assembly')]));
    if (entries.length) main.append(node('ul', { class: 'box side-list' }, entries));
    else main.append(node('p', { text: 'This recipe has no separate side dishes.' }));
  }


  function createHome() {
    const form = node('form', { class: 'card-section recipe-form' });
    const draft = node('textarea', {
      id: 'recipe-draft', rows: '7', placeholder: 'Paste ingredients and cooking instructions…',
      'aria-describedby': 'recipe-storage-note'
    });
    const fileInput = node('input', {
      id: 'recipe-file', type: 'file', accept: '.txt,.md,text/plain,text/markdown'
    });
    const save = node('button', { class: 'action primary', type: 'submit', text: 'Save recipe' });
    const status = node('p', { class: 'recipe-status', role: 'status' });
    const entries = node('div', { class: 'personal-recipes' });

    const importCode = node('input', {
      id: 'recipe-import-code', type: 'password', autocomplete: 'off', autocapitalize: 'none',
      spellcheck: 'false', maxlength: '128'
    });
    const parse = button('Make cooking cards', async () => {
      const text = draft.value;
      if (!text.trim()) {
        status.textContent = 'Paste a recipe or choose a file first.';
        draft.focus();
        return;
      }
      if (text.length > 16000) {
        status.textContent = 'Use at most 16,000 characters for conversion.';
        return;
      }
      const code = importCode.value.trim();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) {
        status.textContent = 'Enter your import code first.';
        importCode.focus();
        return;
      }
      setBusy(true);
      importCode.disabled = true;
      status.textContent = 'Making cooking cards…';
      try {
        const response = await fetch(parserEndpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + code, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(32000)
        });
        const result = await response.json();
        if (!response.ok) {
          status.textContent = result.error || 'Recipe conversion failed.';
          return;
        }
        const parsed = usableRecipe(result.recipe);
        try {
          const recipes = [{ title: parsed.title, text, parsed }, ...readPersonalRecipes()];
          localStorage.setItem(libraryKey, JSON.stringify(recipes));
        } catch {
          status.textContent = 'Could not save the cooking cards. Your text is still in the box.';
          return;
        }
        importCode.value = '';
        location.assign(recipeLink('local', parsed.id));
      } catch {
        status.textContent = 'Could not make cooking cards. Your text is still in the box.';
      } finally {
        importCode.disabled = false;
        setBusy(false);
      }
    }, { class: 'action primary' });

    function setBusy(busy) {
      draft.readOnly = busy;
      fileInput.disabled = busy;
      save.disabled = busy;
      parse.disabled = busy;
    }


    function showRecipes(recipes, openFirst = false) {
      entries.replaceChildren(...recipes.map(({ title, text, parsed }, index) => node('details', {
        class: 'box', ...(openFirst && index === 0 ? { open: '' } : {})
      }, [
        node('summary', { text: title }),
        ...(parsed ? [node('a', { class: 'saved-recipe-link', href: recipeLink('local', parsed.id), text: 'Open cooking cards' })] : []),
        node('div', { class: 'recipe-text', text }),
        ...(!parsed && parserEndpoint ? [button('Use this text', () => {
          if (save.disabled) return;
          draft.value = text;
          draft.focus();
        }, { class: 'action saved-recipe-action' })] : [])
      ])));
      if (!recipes.length) entries.append(node('p', { class: 'muted', text: 'No saved recipes yet.' }));
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!/\.(txt|md)$/i.test(file.name)) {
        status.textContent = 'Choose a .txt or .md file.';
        return;
      }
      setBusy(true);
      status.textContent = 'Reading file…';
      try {
        const text = await file.text();
        if (!text.trim()) {
          status.textContent = 'This file is empty.';
          return;
        }
        draft.value = text;
        status.textContent = 'File loaded. Tap Save recipe to keep it.';
      } catch {
        status.textContent = 'Could not read the file. You can paste its text into the box.';
      } finally {
        setBusy(false);
      }
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const text = draft.value;
      if (!text.trim()) {
        status.textContent = 'Paste a recipe or choose a file first.';
        draft.focus();
        return;
      }
      const heading = text.trim().split(/\r?\n/, 1)[0].replace(/^#{1,6}\s+/, '').trim();
      const title = heading.length > 80 ? heading.slice(0, 77) + '…' : heading;
      let recipes;
      try {
        recipes = [{ title: title || 'Untitled recipe', text }, ...readPersonalRecipes()];
        localStorage.setItem(libraryKey, JSON.stringify(recipes));
      } catch {
        status.textContent = 'Could not save this recipe. Your text is still in the box.';
        return;
      }
      draft.value = '';
      status.textContent = 'Recipe saved.';
      showRecipes(recipes, true);
    });

    try {
      showRecipes(readPersonalRecipes());
    } catch {
      entries.textContent = 'Could not open saved recipes in this browser.';
    }
    form.append(
      node('label', { for: 'recipe-draft', text: 'Paste recipe text' }), draft,
      node('label', { for: 'recipe-file', text: 'Or load a .txt or .md file' }), fileInput,
      node('p', { id: 'recipe-storage-note', class: 'muted', text: 'Saved as text in this browser. Recipes stay on this device and can be lost if you clear site data.' }),
      save
    );
    if (parserEndpoint) {
      form.append(node('div', { class: 'parser-controls' }, [
        node('label', { for: 'recipe-import-code', text: 'Import code' }),
        importCode,
        node('p', { class: 'muted', text: 'Making cooking cards sends the recipe text to Google Gemini.' }),
        parse
      ]));
    }
    form.append(status);
    const personal = node('section', { class: 'library-section', 'aria-labelledby': 'personal-recipes-label' }, [
      node('h2', { id: 'personal-recipes-label', text: 'Your recipes' }), entries
    ]);
    const featured = node('section', { class: 'library-section', 'aria-labelledby': 'featured-recipe-label' }, [
      node('h2', { id: 'featured-recipe-label', text: 'Featured recipe' }),
      node('div', { class: 'box' }, [button(recipe.title, () => route('shop'), { class: 'row featured-recipe' })])
    ]);
    return [title('Add a recipe'), form, personal, featured];
  }

  let home;
  function renderHome() {
    home ??= createHome();
    main.append(...home);
  }

  const buttons = tabs.map((tab) => button(tab, () => route(tab)));
  nav.querySelector('.tabs').replaceChildren(...buttons);
  function render(moveFocus = false) {
    const [page, id] = location.hash.slice(1).split('/');
    const index = tabs.findIndex((tab) => tab.toLowerCase() === page);
    const active = index < 0 || (isRecipeLink && index === 0) ? Number(isRecipeLink) : index;
    buttons.forEach((element, i) => {
      if (i === active) element.setAttribute('aria-current', 'page');
      else element.removeAttribute('aria-current');
    });
    const isHome = active === 0;
    heading.textContent = isHome ? 'Shake and Bake' : recipe.title;
    document.title = heading.textContent;
    summary.hidden = isHome;
    summary.textContent = recipe.summary;
    meta.hidden = isHome;
    main.replaceChildren();
    [renderHome, renderShop, renderTimeline, renderCook, renderSides][active](id);
    if (moveFocus) {
      window.scrollTo(0, 0);
      if (window.matchMedia('(pointer: fine)').matches) main.querySelector('h2')?.focus({ preventScroll: true });
    }
  }
  window.addEventListener('hashchange', () => render(true));
  render();
};


async function loadRecipe() {
  if (recipeLocation.has('local')) {
    const id = recipeLocation.get('local');
    const { parsed } = readPersonalRecipes().find((entry) => entry.parsed?.id === id) ?? {};
    renderRecipe(usableRecipe(parsed));
    return;
  }
  const id = recipeLocation.get('recipe') ?? featuredId;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 80) throw new Error('Invalid recipe ID');
  const response = await fetch('./recipes/' + id + '.json');
  if (!response.ok) throw new Error('Recipe request failed');
  const recipe = usableRecipe(await response.json());
  if (recipe.id !== id) throw new Error('Recipe ID does not match file');
  renderRecipe(recipe);
}

loadRecipe().catch(() => {
  const status = document.querySelector('#recipe-status');
  if (!status) return;
  status.textContent = 'Could not open this recipe. ';
  const home = document.createElement('a');
  home.href = location.pathname;
  home.textContent = 'Back to Home';
  status.append(home);
});
