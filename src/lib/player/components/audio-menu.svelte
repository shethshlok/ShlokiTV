<script lang="ts">
	import AudioLinesIcon from "@lucide/svelte/icons/audio-lines";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import { getLocale, m } from "#lib/i18n/index.js";
	import { audioChoiceLabel } from "#lib/player/audio-language.js";

	let {
		tracks,
		active,
		open,
		onOpenChange,
		onSelect,
		onSources,
	}: {
		tracks: Array<{ id: number; label: string; language?: string }>;
		active: number;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSelect: (id: number) => void;
		onSources?: () => void;
	} = $props();
</script>

<DropdownMenu.Root {open} {onOpenChange}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button variant="ghost" aria-label={m.player_audio()} title={m.player_audio()}
        class="min-h-11 gap-1.5 rounded-full px-3 text-white hover:bg-white/15 hover:text-white dark:hover:bg-white/15" {...props}>
        <AudioLinesIcon class="size-4" />{m.player_audio()}
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" side="top" sideOffset={8}
    class="dark max-h-[70dvh] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl bg-zinc-950/95 p-2 text-white shadow-xl ring-1 ring-white/20">
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>{m.player_audio()}</DropdownMenu.GroupHeading>
      {#if tracks.length}
        <DropdownMenu.RadioGroup value={String(active)} onValueChange={(value) => onSelect(Number(value))}>
          {#each tracks as track (track.id)}
            <DropdownMenu.RadioItem value={String(track.id)} class="min-h-11 rounded-lg focus:bg-white/15 focus:text-white">
              <span class="whitespace-normal">{audioChoiceLabel(track, getLocale()) || m.player_audio_track_fallback({number: track.id + 1})}</span>
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
        {#if tracks.length === 1}<p class="px-2 py-3 text-xs text-white/60">{m.player_audio_one_track()}</p>{/if}
      {:else}
        <p class="px-2 py-3 text-sm text-white/70">{m.player_audio_no_tracks()}</p>
      {/if}
      {#if onSources}
        <DropdownMenu.Separator />
        <DropdownMenu.Item class="min-h-11 rounded-lg focus:bg-white/15 focus:text-white" onSelect={() => {onOpenChange(false);onSources?.();}}>
          {m.player_audio_choose_source()}
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
