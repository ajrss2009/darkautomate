import * as assert from 'node:assert';
import { applyDnaToSkill, audioSummary, normalizeDna, parseAudioStats } from '../main/channel-dna';
import type { Skill } from '../shared/types';

/* Testes das partes puras da análise de canal (sem rede/ffmpeg):
   - perfil de áudio (loudness, pausas, grave/trilha) a partir da saída do ffmpeg;
   - DNA novo (texto na tela, áudio, trilha sonora);
   - injeção do DNA na skill (texto → code_scene/subtitles; trilha → music). */
function main() {
  // 1. parseAudioStats: -18 dB média, -2 pico, grave -30 (razão ≈ 0,25), 1,5 s de silêncio em 60 s, -14,5 LUFS
  const p = parseAudioStats({
    full: '[Parsed_volumedetect_0 @ 0x1] mean_volume: -18.0 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -2.0 dB',
    bass: '[Parsed_volumedetect_0 @ 0x2] mean_volume: -30.0 dB',
    silence: '[silencedetect @ 0x3] silence_start: 1\n[silencedetect @ 0x3] silence_end: 2 | silence_duration: 1\n[silencedetect @ 0x3] silence_start: 5\n[silencedetect @ 0x3] silence_end: 5.5 | silence_duration: 0.5',
    loudness: '[Parsed_ebur128_0 @ 0x4] Summary:\n  I: -14.5 LUFS\n  LRA: 3.2 LU\n  Peak: -1.0 dBFS',
  }, 60);
  assert.equal(p.meanDb, -18);
  assert.equal(p.peakDb, -2);
  assert.equal(p.lufs, -14.5);
  assert.equal(p.pauses, 2);
  assert.equal(p.silenceRatio, 0.025);
  assert.equal(p.avgPauseSec, 0.8);
  assert.ok(p.bassRatio !== undefined && Math.abs(p.bassRatio - 0.251) < 0.01, `bassRatio=${p.bassRatio}`);
  assert.equal(p.musicLikely, true);

  // sem grave e com muito silêncio → sem trilha provável
  const quiet = parseAudioStats({ full: 'mean_volume: -30 dB', bass: 'mean_volume: -60 dB', silence: 'silence_duration: 30', loudness: '' }, 60);
  assert.equal(quiet.musicLikely, false);
  assert.equal(quiet.silenceRatio, 0.5);

  // resumo legível
  assert.match(audioSummary(p), /-14\.5 LUFS/);
  assert.match(audioSummary(p), /trilha de fundo provável/);
  assert.equal(audioSummary(undefined), '');

  // 2. normalizeDna: campos novos (texto, áudio, trilha)
  const dna = normalizeDna({
    text: { onScreen: 'palavra-chave grande no topo', typography: 'Montserrat ExtraBold, contorno preto', captions: 'palavra por palavra', emphasis: 'amarelo no destaque', pacing: 'novo texto a cada 2 s' },
    audio: { narration: 'voz jovem e rápida', loudness: '-14 LUFS, pico -1', mix: 'voz domina, trilha -20 dB com ducking', sfx: 'whoosh nos cortes' },
    soundtrack: { genre: 'lo-fi', mood: 'curioso', tempo: '90 BPM', instruments: 'piano + vinil', entry: 'entra aos 2 s, para nas pausas' },
  });
  assert.equal(dna.text?.onScreen, 'palavra-chave grande no topo');
  assert.equal(dna.audio?.mix, 'voz domina, trilha -20 dB com ducking');
  assert.equal(dna.soundtrack?.genre, 'lo-fi');
  assert.equal(dna.soundtrack?.tempo, '90 BPM');

  // 3. applyDnaToSkill: texto entra em code_scene/subtitles; trilha entra em music; áudio/SFX em narration/sfx
  const sk = applyDnaToSkill({ id: 't', name: 't', aspect: '16:9', steps: {} } as unknown as Skill, dna, { wpm: 160 });
  assert.match(sk.steps['code_scene'] ?? '', /TEXTO NA TELA NO FORMATO/);
  assert.match(sk.steps['subtitles'] ?? '', /tipografia: Montserrat/);
  assert.match(sk.steps['music'] ?? '', /lo-fi/);
  assert.match(sk.steps['sfx'] ?? '', /whoosh/);
  assert.match(sk.steps['narration'] ?? '', /voz jovem/);

  console.log('channel-dna tests: OK');
}

main();
