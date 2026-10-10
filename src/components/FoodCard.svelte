<script>
  import { formatAmount, NUTRIENTS } from '../lib/foods.js';
  let { food } = $props();
  let expanded = $state(false);
  const nutrition = $derived(food.nutrients);
  const macrosKnown = $derived([nutrition.protein, nutrition.netCarbs, nutrition.fat].every(v => v != null));
  const macroEnergy = $derived((nutrition.protein ?? 0) * 4 + (nutrition.netCarbs ?? 0) * 4 + (nutrition.fat ?? 0) * 9);
</script>

<article class="food-card">
  <div class="food-top">
    <div class="food-title">
      <h2>{food.name}</h2>
      <p>{food.categoryName}<span class="separator">·</span><strong>{food.serving.label}</strong> ({formatAmount(food.serving.grams)} g)</p>
    </div>
    <div class="headline-nutrient"><strong>{formatAmount(nutrition.calories)}</strong><span>kcal</span></div>
    <div class="headline-nutrient protein"><strong>{formatAmount(nutrition.protein)}</strong><span>g protein</span></div>
    <button class="expand" aria-expanded={expanded} aria-controls={`detail-${food.id}`} aria-label={`${expanded ? 'Hide' : 'Show'} details for ${food.name}`} onclick={() => expanded = !expanded}>{expanded ? '−' : '+'}</button>
  </div>
  <div class="food-bottom">
    <div class="macro-bar" aria-hidden="true">
      {#if macrosKnown && macroEnergy > 0}
        <span class="protein-bar" style:flex={(nutrition.protein * 4) / macroEnergy}></span>
        <span class="carb-bar" style:flex={(nutrition.netCarbs * 4) / macroEnergy}></span>
        <span class="fat-bar" style:flex={(nutrition.fat * 9) / macroEnergy}></span>
      {/if}
    </div>
    <p>{formatAmount(nutrition.netCarbs)} g net carbs<span class="separator">·</span>{formatAmount(nutrition.fat)} g fat<span class="separator">·</span>{formatAmount(nutrition.sodium)} mg sodium</p>
  </div>
  {#if expanded}
    <div class="food-detail" id={`detail-${food.id}`}>
      <p class="detail-caption">Nutrition per {food.serving.label} ({formatAmount(food.serving.grams)} g)</p>
      <dl>
        {#each [...NUTRIENTS, { key: 'carbs', label: 'Total carbs', unit: 'g' }, { key: 'fiber', label: 'Fiber', unit: 'g' }, { key: 'saturatedFat', label: 'Saturated fat', unit: 'g' }] as nutrient}
          <div><dt>{nutrient.label}</dt><dd>{nutrition[nutrient.key] == null ? 'Not reported' : `${formatAmount(nutrition[nutrient.key])} ${nutrient.unit}`}</dd></div>
        {/each}
      </dl>
      <p class="detail-note">Source: {food.source.replace(', per 100 g', '')}. Values converted to the listed serving. Net carbs = total carbs − fiber. The bar shows estimated energy from protein, net carbs, and fat.</p>
    </div>
  {/if}
</article>
