const renderRecipe = (recipe) => {
  document.title = recipe.title;
  document.querySelector('h1').textContent = recipe.title;
  document.querySelector('.summary').textContent = recipe.summary;
  const meta = document.querySelector('.meta');
  for (const text of [recipe.servings, recipe.prep, recipe.cook].filter(Boolean)) {
    const item = document.createElement('li');
    item.textContent = text;
    meta.append(item);
  }
  const cards = new Map(recipe.cards.map((card) => [card.id, card]));
  const main = document.querySelector('main');
  const nav = document.querySelector('nav');
  const tabs = ['Shop', 'Timeline', 'Cook', 'Sides'];
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
    if (location.hash !== next) location.hash = next;
  }
  function renderShop() {
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
    const input = node('input', { type: 'time', value: state.dinner });
    const rows = node('ul', { class: 'box timeline' });
    const update = () => {
      const [hours, minutes] = state.dinner.split(':').map(Number);
      rows.replaceChildren(...recipe.timeline.map(({ offsets, label, cardId }) => {
        const stamps = offsets.map((offset) => hours * 60 + minutes + offset);
        const day = (stamp) => stamp < 0 ? 'previous day' : stamp >= 1440 ? 'next day' : '';
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
    main.append(section('Ingredients', 'ul', card.ingredients, 'ingredient-list'));
    main.append(section(card.id === 'assembly' ? 'Set out' : 'Method', card.id === 'assembly' ? 'ul' : 'ol', card.steps, card.id === 'assembly' ? 'ingredient-list' : ''));
    if (card.notes.length) main.append(section('Notes', 'ul', card.notes, 'notes'));
    if (card.id === 'marinate' || card.id === 'fry') main.append(node('p', { class: 'safety', text: recipe.safety }));
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
    main.append(node('div', { class: 'section-head' }, [title('Sides & assembly')]), node('ul', { class: 'box side-list' }, entries));
  }

  const buttons = tabs.map((tab) => button(tab, () => route(tab)));
  nav.querySelector('.tabs').replaceChildren(...buttons);
  function render(moveFocus = false) {
    const [page, id] = location.hash.slice(1).split('/');
    const index = tabs.findIndex((tab) => tab.toLowerCase() === page);
    const active = index < 0 ? 0 : index;
    buttons.forEach((element, i) => {
      if (i === active) element.setAttribute('aria-current', 'page');
      else element.removeAttribute('aria-current');
    });
    main.replaceChildren();
    [renderShop, renderTimeline, renderCook, renderSides][active](id);
    if (moveFocus) {
      window.scrollTo(0, 0);
      if (window.matchMedia('(pointer: fine)').matches) main.querySelector('h2')?.focus({ preventScroll: true });
    }
  }
  window.addEventListener('hashchange', () => render(true));
  render();
};

async function loadRecipe() {
  const response = await fetch('./recipes/fried-chicken-factory.json');
  if (!response.ok) throw new Error(`Recipe request failed: ${response.status}`);
  renderRecipe(await response.json());
}

loadRecipe().catch((error) => {
  console.error(error);
  const status = document.querySelector('#recipe-status');
  if (status) status.textContent = 'Could not load the recipe. Try refreshing the page.';
});
