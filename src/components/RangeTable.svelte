<script>
  import { NUTRIENTS } from '../lib/foods.js';
  let { ranges = $bindable(), error = '', onchange } = $props();
</script>

<div class="range-table">
  <div class="range-header"><span>Nutrient</span><span>Min</span><span>Max</span></div>
  {#each NUTRIENTS as nutrient}
    {@const range = ranges[nutrient.key]}
    {@const active = range.min != null || range.max != null}
    {@const invalid = range.min != null && range.max != null && range.min > range.max}
    <div class="range-row" class:active>
      <div class="nutrient-label"><span class="active-dot"></span>{nutrient.label} <small>{nutrient.unit}</small></div>
      <input type="number" min="0" step="any" inputmode="decimal" placeholder="–" aria-label={`${nutrient.label} minimum`} aria-invalid={invalid} aria-describedby={error ? 'range-error' : undefined} class:filled={range.min != null} bind:value={ranges[nutrient.key].min} oninput={onchange} />
      <input type="number" min="0" step="any" inputmode="decimal" placeholder="–" aria-label={`${nutrient.label} maximum`} aria-invalid={invalid} aria-describedby={error ? 'range-error' : undefined} class:filled={range.max != null} bind:value={ranges[nutrient.key].max} oninput={onchange} />
    </div>
  {/each}
</div>
{#if error}<p class="range-error" id="range-error" role="alert">{error}</p>{/if}
