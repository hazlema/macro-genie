<script>
  import { onMount } from 'svelte';
  import { navigate } from '../lib/route.svelte.js';
  import { account } from '../lib/account.svelte.js';

  let { foodCount = null } = $props();

  // A real wish, sized by the app's own solver from USDA data (2 servings).
  const WISH = 'Dinner for two with salmon. At least 40 g of protein and under 600 calories each.';
  const GRANTED = {
    name: 'Seared salmon with chickpeas, spinach and cherry tomatoes',
    ingredients: [['Salmon, cooked', 340], ['Chickpeas, rinsed', 200], ['Cherry tomatoes', 200], ['Spinach', 90]],
    per: [['517', 'kcal'], ['47 g', 'protein'], ['20 g', 'net carbs'], ['24 g', 'fat']],
  };

  // The one moment of motion: the wish is written out, then the recipe
  // clears out of the smoke. Reduced motion shows it all at once.
  // It starts when the band scrolls into view.
  let typed = $state(WISH.length);
  let granted = $state(true);
  let band;
  onMount(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    typed = 0; granted = false;
    // Paced by the clock, so a throttled background tab still finishes on time.
    let timer, start;
    const step = () => {
      typed = Math.min(WISH.length, Math.floor((performance.now() - start) / 32));
      if (typed < WISH.length) timer = setTimeout(step, 32);
      else timer = setTimeout(() => granted = true, 350);
    };
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      seen.disconnect();
      start = performance.now() + 300;
      timer = setTimeout(step, 300);
    }, { threshold: 0.4 });
    seen.observe(band);
    return () => { seen.disconnect(); clearTimeout(timer); };
  });

  const foods = $derived(foodCount ? foodCount.toLocaleString() : 'thousands of');
  function go(event, tab) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    navigate({ tab });
    scrollTo(0, 0);
  }
</script>

<main id="results" tabindex="-1" class="landing">
  <section class="hero">
    <picture class="hero-art">
      <source media="(max-width: 760px)" srcset="/img/genie-lamp-720.webp" />
      <img src="/img/genie-lamp.webp" alt="A brass genie lamp on a dark counter, its smoke curling up into salmon, chickpeas, tomatoes, avocado and an egg." width="1100" height="1375" fetchpriority="high" />
    </picture>
    <div class="hero-copy">
      <h1>Your macros, granted.</h1>
      <p class="lede">Say what you want to eat and the numbers it has to hit. Macro Genie finds the foods and sizes every gram of the recipe so each serving lands in range.</p>

      <div class="hero-actions">
        <a class="wish-button" href="/community" onclick={(e) => go(e, 'community')}>Get started</a>
        <a class="quiet-link" href="/foods" onclick={(e) => go(e, 'foods')}>Search {foods} foods</a>
      </div>
    </div>
  </section>

  <section class="wish-band" bind:this={band}>
    <blockquote class="wish-text">
      <span class="sr-only">An example wish: {WISH}</span>
      <span aria-hidden="true">“{WISH.slice(0, typed)}{typed < WISH.length ? '' : '”'}</span>{#if typed < WISH.length}<span class="caret" aria-hidden="true"></span>{/if}
    </blockquote>
    <div class="granted" class:shown={granted}>
      <p class="granted-name">{GRANTED.name}</p>
      <ul class="granted-list">
        {#each GRANTED.ingredients as [food, grams]}<li><span>{food}</span><span>{grams} g</span></li>{/each}
      </ul>
      <dl class="granted-macros">
        {#each GRANTED.per as [value, label]}<div><dt>{label}</dt><dd>{value}</dd></div>{/each}
      </dl>
      <p class="granted-note">Per serving, sized by Macro Genie from USDA nutrition data.</p>
    </div>
  </section>

  <section class="wishes" aria-labelledby="wishes-title">
    <h2 id="wishes-title">Three wishes, one kitchen</h2>
    <div class="wish-row">
      <article>
        <h3>Find what fits</h3>
        <p>Set ranges for protein, net carbs, fat, calories, sugar and sodium. See every food that fits, per serving or per 100 g.</p>
        <a href="/foods" onclick={(e) => go(e, 'foods')}>Open Food Macros</a>
      </article>
      <article>
        <h3>Cook it to the gram</h3>
        <p>Name the foods you like and the targets you need. You get recipe ideas, then a written recipe sized to your numbers that scales to any number of servings.</p>
        <a href="/builder" onclick={(e) => go(e, 'recipes')}>Open the Recipe Builder</a>
      </article>
      <article>
        <h3>Share what worked</h3>
        <p>Post recipes you loved, browse other people’s by meal and macros, save the good ones to your Recipe Book, and ask questions in the forums.</p>
        <a href="/community" onclick={(e) => go(e, 'community')}>Visit the Community</a>
      </article>
    </div>
  </section>

  <section class="free" aria-labelledby="free-title">
    <h2 id="free-title">Free to use</h2>
    <p class="free-lede">No card and no trial clock. Most of Macro Genie needs no account at all.</p>
    <div class="free-columns">
      <div>
        <h3>Free, no account</h3>
        <ul>
          <li>Search all {foods} foods by your numbers</li>
          <li>Browse community recipes and forums</li>
          <li>Keep, print and scale recipes in your Recipe Book</li>
          <li>Use the food search from Claude through our MCP server</li>
        </ul>
      </div>
      <div>
        <h3>Free with a Google sign-in</h3>
        <ul>
          <li>10 credits to start: one credit makes a recipe idea or writes a recipe</li>
          <li>Post recipes, start threads, like and comment</li>
          <li>When credits run out, everything above keeps working</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="closing">
    <p>The lamp is warm.</p>
    {#if account.signedIn}
      <a class="wish-button" href="/community" onclick={(e) => go(e, 'community')}>Get started</a>
    {:else}
      <button class="wish-button" onclick={() => account.loginOpen = true}>Sign in and get 10 credits</button>
    {/if}
  </section>

  <footer><p>Food by your numbers. <span>Nutrition from the USDA SR Legacy database.</span></p></footer>
</main>

<style>
  .landing {
    --ink: #111415;
    --brass: #d6a24c;
    --smoke: #b8b2d6;
    --paper: #e6e8e4;
    padding: 0;
    color: var(--paper);
  }
  h1, h2, h3, .granted-name, .closing p {
    font-family: 'Gloock', Georgia, serif;
    font-weight: 400;
  }

  /* Hero: the photo sits on the right and fades into the page on its left. */
  .hero {
    position: relative;
    min-height: clamp(560px, calc(100vh - 105px), 860px);
    display: flex;
    align-items: center;
    padding: 64px 3.2% 72px;
    overflow: hidden;
    isolation: isolate;
  }
  .hero-art {
    position: absolute;
    inset: 0 0 0 auto;
    aspect-ratio: 4 / 5;
    max-width: 64%;
    z-index: -1;
  }
  .hero-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 70% 40%;
    display: block;
    mask-image: linear-gradient(to right, transparent 0, #000 55%), linear-gradient(to top, transparent 0, #000 16%), linear-gradient(to bottom, transparent 0, #000 12%);
    mask-composite: intersect;
  }
  .hero-copy {
    max-width: 700px;
  }
  h1 {
    font-size: clamp(56px, 7.6vw, 116px);
    line-height: 0.92;
    letter-spacing: -0.02em;
    margin: 0 0 28px;
    color: var(--paper);
  }
  .lede {
    font-size: 19px;
    line-height: 1.6;
    color: #c9ccc6;
    max-width: 30em;
    margin: 0 0 40px;
  }

  /* The example wish on the left, the recipe it became on the right. */
  .wish-band {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 48px 72px;
    align-items: center;
    padding: 96px 3.2%;
    border-top: 1px solid var(--line);
  }
  .wish-text {
    margin: 0;
    font-family: 'Gloock', Georgia, serif;
    font-size: clamp(30px, 3.4vw, 46px);
    line-height: 1.2;
    color: var(--smoke);
    min-height: 3.6em;
    max-width: 18em;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .caret {
    display: inline-block;
    width: 2px;
    height: 1em;
    margin-left: 2px;
    vertical-align: -0.12em;
    background: var(--smoke);
    animation: blink 0.9s steps(1) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  .granted {
    border-left: 2px solid var(--brass);
    padding: 4px 0 4px 26px;
    max-width: 520px;
    opacity: 0;
    filter: blur(10px);
    transform: translateY(6px);
    transition: opacity 0.9s ease-out, filter 1.1s ease-out, transform 0.9s ease-out;
  }
  .granted.shown {
    opacity: 1;
    filter: none;
    transform: none;
  }
  .granted-name {
    font-size: 21px;
    line-height: 1.3;
    margin: 0 0 14px;
    color: var(--brass);
  }
  .granted-list {
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
    font-size: 15px;
  }
  .granted-list li {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 6px 0;
    border-bottom: 1px dotted #3a4043;
  }
  .granted-list li span:last-child {
    font-variant-numeric: tabular-nums;
    color: #c9ccc6;
  }
  .granted-macros {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 26px;
    margin: 0 0 8px;
  }
  .granted-macros div {
    display: flex;
    flex-direction: column-reverse;
  }
  .granted-macros dd {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    color: var(--lime);
    font-variant-numeric: tabular-nums;
  }
  .granted-macros dt {
    font-size: 13px;
    color: var(--muted);
  }
  .granted-note {
    font-size: 13px;
    color: var(--muted);
    margin: 0;
  }

  .hero-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 18px 30px;
  }
  .wish-button {
    display: inline-block;
    background: var(--lime);
    color: var(--ink);
    border: 0;
    border-radius: 999px;
    padding: 16px 30px;
    font-weight: 650;
    font-size: 17px;
    text-decoration: none;
  }
  .wish-button:hover {
    background: #d3e98a;
  }
  .quiet-link,
  .wish-row a {
    color: var(--paper);
    text-decoration: underline;
    text-decoration-color: var(--brass);
    text-underline-offset: 5px;
    text-decoration-thickness: 1px;
  }
  .quiet-link:hover,
  .wish-row a:hover {
    text-decoration-thickness: 2px;
  }

  /* Three wishes: one row, separated by brass hairlines rather than boxes. */
  .wishes,
  .free {
    padding: 96px 3.2%;
    border-top: 1px solid var(--line);
  }
  h2 {
    font-size: clamp(36px, 4.4vw, 56px);
    line-height: 1.05;
    letter-spacing: -0.01em;
    margin: 0 0 44px;
  }
  .wish-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .wish-row article {
    padding: 0 36px;
    border-left: 1px solid color-mix(in srgb, var(--brass) 45%, transparent);
  }
  .wish-row article:first-child {
    padding-left: 0;
    border-left: 0;
  }
  h3 {
    font-size: 27px;
    line-height: 1.15;
    margin: 0 0 14px;
  }
  .wish-row p,
  .free li,
  .free-lede {
    font-size: 16px;
    line-height: 1.65;
    color: #c2c6c0;
    max-width: 34em;
  }
  .wish-row p {
    margin: 0 0 18px;
  }

  /* Free to use: two plain lists, what needs nothing and what needs a sign-in. */
  .free h2 {
    margin-bottom: 14px;
  }
  .free-lede {
    margin: 0 0 44px;
    font-size: 18px;
  }
  .free-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    max-width: 1080px;
  }
  .free h3 {
    font-size: 23px;
    color: var(--brass);
  }
  .free ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .free li {
    padding: 12px 0 12px 26px;
    border-top: 1px solid var(--line);
    position: relative;
    max-width: none;
  }
  .free li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 21px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--lime);
  }

  .closing {
    padding: 96px 3.2% 104px;
    border-top: 1px solid var(--line);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 24px 40px;
  }
  .closing p {
    font-size: clamp(40px, 5.6vw, 76px);
    line-height: 1;
    margin: 0;
    color: var(--brass);
  }
  .landing footer {
    padding: 28px 3.2% 40px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 13px;
  }
  .landing footer p {
    margin: 0;
  }

  @media (max-width: 1100px) {
    .hero-art {
      opacity: 0.6;
    }
  }
  @media (max-width: 760px) {
    .hero {
      display: block;
      min-height: 0;
      padding: 0 20px 56px;
    }
    .hero-art {
      position: relative;
      display: block;
      aspect-ratio: auto;
      max-width: none;
      height: 380px;
      margin: 0 -20px -70px;
      opacity: 1;
    }
    .hero-art img {
      object-position: 60% 45%;
      mask-image: linear-gradient(to top, transparent 0, #000 40%);
      mask-composite: add;
    }
    h1 {
      font-size: 58px;
    }
    .lede {
      font-size: 17px;
    }
    .wish-band {
      grid-template-columns: 1fr;
      padding: 64px 20px;
    }
    .wish-text {
      font-size: 28px;
      min-height: 0;
    }
    .wishes,
    .free,
    .closing {
      padding: 64px 20px;
    }
    .wish-row,
    .free-columns {
      grid-template-columns: 1fr;
      gap: 40px;
    }
    .wish-row article {
      padding: 0;
      border-left: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .granted {
      transition: none;
    }
    .caret {
      animation: none;
    }
  }
</style>
