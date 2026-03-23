<script>
  import { formatRelativeTime, formatTimestamp, summarizeEventLine } from "./format.js";

  export let items = [];

  $: lines = items.map((item) => summarizeEventLine(item));
</script>

<section class="stream-panel transcript-panel">
  <div class="panel-header">
    <h3>transcript</h3>
    <span class="panel-count">{lines.length}</span>
  </div>

  {#if lines.length === 0}
    <div class="empty">no event lines</div>
  {:else}
    <div class="stream timeline">
      {#each lines as line}
        <article class={`stream-line timeline-line ${line.tone}`}>
          <div class="timeline-meta">
            <span class="timeline-lane">{line.lane}</span>
            <span class="timeline-when" title={formatTimestamp(line.timestamp)}>
              {line.timestamp ? `${formatRelativeTime(line.timestamp)} ago` : "no timestamp"}
            </span>
          </div>
          <div class="timeline-title">{line.title}</div>
          {#if line.detail}
            <div class="timeline-detail">{line.detail}</div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
