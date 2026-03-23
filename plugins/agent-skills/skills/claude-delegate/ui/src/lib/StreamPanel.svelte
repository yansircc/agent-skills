<script>
  import { formatJson } from "./format.js";

  export let title;
  export let items = [];
  export let empty = "no output";
  export let json = false;
</script>

<section class="stream-panel">
  <div class="panel-header">
    <h3>{title}</h3>
    <span class="panel-count">{items.length}</span>
  </div>
  {#if items.length === 0}
    <div class="empty">{empty}</div>
  {:else}
    <div class="stream">
      {#each items as item}
        <article class="stream-line">
          {#if json && item.parsed}
            <pre>{formatJson(item.parsed)}</pre>
          {:else}
            <pre>{item.raw}</pre>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
