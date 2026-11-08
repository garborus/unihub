// Sub-aba "Luzes" do GameSir: editor das animações de iluminação.
//
// Fluxo: lê o bloco de luz (slot 32) do controle, edita um modelo em memória
// e, a cada mudança, grava só o trecho de bytes que mudou.

import { h, clear, card, button } from '../../../core/dom.js';
import { controllerSvg, XBOX_PAD_PATH } from '../../../shared/controller-art.js';
import { openColorPicker } from '../../../shared/color-picker.js';
import { PROFILE_SLOTS } from '../../../plugins/gamepads/gamesir/protocol.js';
import { strokeIcon } from '../../../shared/icon-card.js';
import {
  LIGHT_SLOT, LIGHT_BLOCK_SIZE, EDITABLE_ANIMATIONS, MAX_KEYFRAMES, MAX_SPEED, STANDBY_OPTIONS,
  LED_LAYOUTS, PRESETS, parseLightBlock, buildLightBlock, changedRange, applyPreset, moveFrame,
} from '../../../plugins/gamepads/gamesir/lights.js';

const ROMAN = ['I', 'II', 'III', 'IV'];
const SAVE_DELAY_MS = 250;

export function lightsTab(session, ctx, model) {
  const layout = LED_LAYOUTS[model] || LED_LAYOUTS.generic;
  const root = h('div', { class: 'lights' }, h('div', { class: 'empty' }, 'Lendo as luzes do controle…'));

  const state = {
    model: null,
    written: null, // últimos bytes confirmados pelo controle
    frame: 0,
    light: 0,
    playing: true,
    preset: null,
    status: '',
  };
  let saveTimer = 0;
  let saving = Promise.resolve();

  const anim = () => state.model.animations[state.model.activeAnimation];

  session.readBlock(LIGHT_SLOT, LIGHT_BLOCK_SIZE).then((bytes) => {
    state.model = parseLightBlock(bytes);
    state.written = bytes;
    render();
  }).catch((err) => {
    clear(root, card('Não foi possível ler as luzes', h('p', {}, err.message),
      h('p', { class: 'muted' }, 'Feche outros apps que estejam usando o controle e abra esta aba de novo.')));
  });

  // Ao sair da aba, devolve o controle para a animação tocando.
  const watcher = setInterval(() => {
    if (root.isConnected || !root.dataset.mounted) {
      if (root.isConnected) root.dataset.mounted = '1';
      return;
    }
    clearInterval(watcher);
    if (!state.playing) session.lightPreview(true, 1).catch(() => {});
  }, 500);

  function change(mutator, { preview = true } = {}) {
    mutator();
    if (preview) {
      state.playing = false;
      session.lightPreview(false, state.frame + 1).catch(() => {});
    }
    render();
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    state.status = 'Alterações pendentes…';
    renderStatus();
    saveTimer = setTimeout(() => {
      saving = saving.then(save, save);
    }, SAVE_DELAY_MS);
  }

  async function save() {
    const bytes = buildLightBlock(state.model);
    const range = changedRange(state.written, bytes);
    if (!range) {
      state.status = 'Salvo no controle';
      return renderStatus();
    }
    state.status = 'Salvando…';
    renderStatus();
    try {
      await session.writeBlock(LIGHT_SLOT, bytes.subarray(range.start, range.end + 1), range.start);
      state.written = bytes;
      state.status = 'Salvo no controle';
      if (!state.playing) session.lightPreview(false, state.frame + 1).catch(() => {});
    } catch (err) {
      state.status = 'Erro ao salvar';
      ctx.toast(`Luzes: ${err.message}`, 'error');
    }
    renderStatus();
  }

  const statusEl = h('span', { class: 'muted small save-status' });
  function renderStatus() {
    statusEl.textContent = state.status;
  }

  function render() {
    if (!state.model) return;
    const a = anim();
    if (state.frame >= a.keyFrames) state.frame = a.keyFrames - 1;
    clear(root,
      h('div', { class: 'lights-panel' },
        // Cabeçalho no padrão das outras telas: ícone, título e o estado da gravação.
        h('div', { class: 'icon-card-head lights-head' },
          h('span', { class: 'icon-card-icon' }, strokeIcon('sparkles')),
          h('h3', {}, 'Luzes do controle'),
          statusEl),
        animationsSection(),
        presetsSection(a),
        framesSection(a),
        lightsSection(a),
        profileSection(),
        sliderSection('Brilho', a.brightness, 0, 100, '%', (v) => change(() => { a.brightness = v; })),
        sliderSection('Velocidade', a.speed, 0, MAX_SPEED, '', (v) => change(() => { a.speed = v; }, { preview: false })),
        toggleRow('Modo reativo a áudio', state.model.audioReactive, (v) => change(() => { state.model.audioReactive = v; }, { preview: false }),
          'As luzes reagem ao som em vez de seguir a animação.'),
        toggleRow('Segure para despertar', state.model.holdToWake, (v) => change(() => { state.model.holdToWake = v; }, { preview: false }),
          'Opção do fabricante. No Cyclone 2 ainda não identificamos efeito.'),
        h('div', { class: 'setting-row' },
          h('span', {}, 'Suspender quando inativo por'),
          button(standbyText(state.model.standbyMinutes), () => change(() => {
            const i = STANDBY_OPTIONS.indexOf(state.model.standbyMinutes);
            state.model.standbyMinutes = STANDBY_OPTIONS[(i + 1) % STANDBY_OPTIONS.length];
          }, { preview: false }))),
      ),
      h('div', { class: 'lights-stage' }, controllerDiagram(a)),
    );
    renderStatus();
  }

  // Animações favoritas: o controle guarda 4; a escolhida é a que toca.
  // Cada cartão mostra a sequência de cores: uma coluna por quadro, uma faixa por luz.
  function animationsSection() {
    return section('Animações', 'Suas 4 animações favoritas, guardadas no controle. Clique em uma para ativar e editar.',
      h('div', { class: 'anim-grid' },
        ROMAN.slice(0, EDITABLE_ANIMATIONS).map((label, i) => {
          const item = state.model.animations[i];
          const active = state.model.activeAnimation === i;
          const frames = Array.from({ length: item.keyFrames }, (_, f) => item.frames[f]);
          return h('button', {
            class: 'anim-card' + (active ? ' selected' : ''),
            'aria-pressed': String(active),
            onclick: () => {
              if (active) return;
              change(() => {
                state.model.activeAnimation = i;
                state.frame = 0;
                state.preset = null;
              }, { preview: false });
            },
          },
          h('span', { class: 'anim-strip', 'aria-hidden': 'true' },
            frames.map((leds) => h('span', { class: 'anim-col' },
              layout.map((light) => h('i', { style: `background:${leds[light.led]}` }))))),
          h('span', { class: 'anim-meta' },
            h('span', { class: 'anim-name' }, label),
            active
              ? h('span', { class: 'anim-badge' }, 'ativa')
              : h('span', { class: 'anim-frames muted' }, item.keyFrames === 1 ? '1 quadro' : `${item.keyFrames} quadros`)));
        })));
  }

  function presetsSection(a) {
    return section('Predefinições', null,
      h('div', { class: 'preset-grid' }, PRESETS.map((p) => h('button', {
        class: 'btn secondary' + (state.preset === p.id ? ' selected' : ''),
        onclick: () => change(() => {
          applyPreset(a, p, layout);
          state.preset = p.id;
          state.frame = 0;
          state.playing = true;
        }, { preview: false }),
      }, p.label))));
  }

  function framesSection(a) {
    let dragFrom = null;
    const chips = Array.from({ length: a.keyFrames }, (_, f) => h('button', {
      class: 'frame-chip' + (state.frame === f ? ' selected' : ''),
      draggable: 'true',
      style: `--c:${a.frames[f][layout[0].led]}`,
      onclick: () => change(() => { state.frame = f; }, { preview: true }),
      ondragstart: () => { dragFrom = f; },
      ondragover: (e) => e.preventDefault(),
      ondrop: (e) => {
        e.preventDefault();
        if (dragFrom === null || dragFrom === f) return;
        const from = dragFrom;
        change(() => { moveFrame(a, from, f); state.frame = f; });
      },
    }, String(f + 1)));

    return section('Quadros-chave', 'Arraste para alterar a ordem',
      h('div', { class: 'row' },
        chips,
        h('span', { class: 'spacer' }),
        button(state.playing ? '❚❚' : '▶', () => {
          state.playing = !state.playing;
          session.lightPreview(state.playing, state.frame + 1).catch(() => {});
          render();
        }),
        button('+', () => change(() => {
          a.frames[a.keyFrames] = [...a.frames[a.keyFrames - 1]];
          a.keyFrames++;
          state.frame = a.keyFrames - 1;
        }), { disabled: a.keyFrames >= MAX_KEYFRAMES }),
        button('−', () => change(() => {
          a.keyFrames--;
        }), { disabled: a.keyFrames <= 1 })));
  }

  function lightsSection(a) {
    return section('Luzes', 'Selecione o número da luz para ajustar sua cor',
      h('div', { class: 'light-swatches' }, layout.map((light, i) => {
        const color = a.frames[state.frame][light.led];
        const dot = h('span', { class: 'swatch-dot', style: `background:${color}` });
        const swatch = h('button', {
          class: 'swatch' + (state.light === i ? ' selected' : ''),
          onclick: () => pickColor(a, i, swatch),
        }, h('span', {}, light.label), dot);
        swatchDots[i] = dot;
        return swatch;
      })));
  }

  // Abre o seletor de cores; só grava no controle ao clicar em Confirmar.
  const swatchDots = [];
  function pickColor(a, i, anchor) {
    const light = layout[i];
    state.light = i;
    openColorPicker({
      anchor,
      value: a.frames[state.frame][light.led],
      onPreview: (hex) => {
        swatchDots[i]?.style.setProperty('background', hex);
        dots[i]?.setAttribute('fill', hex);
      },
      onConfirm: (hex) => change(() => { a.frames[state.frame][light.led] = hex; }),
    });
  }

  // Indicador de perfil: a luz 4 tem 4 trilhas de LED; o perfil N acende N trilhas.
  let profile = null;
  session.readCurrentProfile().then((r) => { profile = r.value; render(); }).catch(() => {});

  function profileSection() {
    return section('Indicador de perfil', 'Escolher um número troca o perfil em uso no controle, com o mapeamento dele.',
      h('div', { class: 'row profile-row' },
        PROFILE_SLOTS.map((n) => h('button', {
          class: 'profile-btn' + (profile === n ? ' selected' : ''),
          onclick: async () => {
            try {
              await session.switchProfile(n);
              profile = (await session.readCurrentProfile()).value;
            } catch (err) {
              ctx.toast(`Trocar perfil: ${err.message}`, 'error');
            }
            render();
          },
        },
        h('span', { class: 'tracks' }, PROFILE_SLOTS.map((t) => h('i', { class: t <= n ? 'on' : '' }))),
        String(n)))));
  }

  let dots = [];
  function controllerDiagram(a) {
    const colors = layout.map((l) => a.frames[state.frame][l.led]);
    // 2 e 4 encostados no corpo (borda de cima e recorte de baixo);
    // 1 e 3 sobre as alças, onde a mão segura.
    const spots = { left: [50, 196], top: [200, 64], right: [350, 196], bottom: [200, 242] };
    const { svg, add: el } = controllerSvg('pad-diagram', XBOX_PAD_PATH);
    dots = layout.map((light, i) => {
      const [x, y] = light.position ? spots[light.position] : [80 + i * 60, 308];
      const dot = el('circle', { cx: x, cy: y, r: 16, fill: colors[i], class: 'pad-led' + (state.light === i ? ' selected' : '') });
      dot.addEventListener('click', () => pickColor(a, i, dot));
      const t = el('text', { x, y: y + 5, class: 'pad-led-label', fill: isLight(colors[i]) ? '#111' : '#fff' });
      t.textContent = light.label;
      return dot;
    });
    return svg;
  }

  return root;
}

function section(title, hint, ...children) {
  return h('section', { class: 'light-section' },
    h('div', { class: 'section-head' }, h('h4', {}, title), hint ? h('span', { class: 'muted small' }, hint) : null),
    ...children);
}

function sliderSection(title, value, min, max, unit, onCommit) {
  const out = h('code', {}, `${value}${unit}`);
  return section(title, null,
    h('div', { class: 'slider-row' },
      h('input', {
        type: 'range', min, max, value,
        oninput: (e) => { out.textContent = `${e.target.value}${unit}`; },
        onchange: (e) => onCommit(Number(e.target.value)),
      }),
      out));
}

function toggleRow(label, checked, onToggle, hint) {
  return h('label', { class: 'setting-row' },
    h('span', { class: 'setting-text' }, h('span', {}, label), hint ? h('small', { class: 'muted' }, hint) : null),
    h('input', { type: 'checkbox', class: 'switch', checked, onchange: (e) => onToggle(e.target.checked) }));
}

function isLight(hex) {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 150;
}

function standbyText(minutes) {
  return minutes === 0 ? 'Desativado' : `${minutes} min`;
}
