import { getContext } from '../../../st-context.js';
import { sendMessageAsUser } from '../../../../script.js';

const KEY = 'quickReplyPickerStyle';
const LAUNCHER_KEY = 'quickReplyPickerLauncher';
const styles = ['compact', 'bubbles'];
let style = styles.includes(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : 'compact';
let showLauncher = localStorage.getItem(LAUNCHER_KEY) !== 'hold';

function members() {
    const ctx = getContext();
    if (!ctx.groupId) return [];
    const group = ctx.group || ctx.groups?.find(g => String(g.id) === String(ctx.groupId));
    return (group?.members || []).map(member => {
        const avatar = typeof member === 'string' ? member : member.avatar;
        const char = ctx.characters?.find(c => c.avatar === avatar);
        return char ? { name: char.name, avatar, muted: group.disabled_members?.includes(avatar) || false } : null;
    }).filter(Boolean);
}

function setLauncherExpanded(expanded) {
    const launcher = document.querySelector('#qrp-launcher');
    if (!launcher) return;
    launcher.setAttribute('aria-expanded', String(expanded));
    const icon = launcher.querySelector('.qrp-launcher-arrow i');
    if (icon) icon.className = `fa-solid fa-chevron-${expanded ? 'down' : 'up'}`;
}

// Put the dropdown in <body> rather than inside #form_sheld: custom themes can
// clip the composer, create stacking contexts, or reposition Quick Replies.
function positionPanel() {
    const panel = document.querySelector('#qrp-panel');
    if (!panel) return;

    const anchor = (showLauncher && document.querySelector('#qrp-launcher'))
        || document.querySelector('#send_form')
        || document.querySelector('#send_but');
    if (!anchor) { close(); return; }

    const view = window.visualViewport;
    const viewportLeft = view?.offsetLeft ?? 0;
    const viewportTop = view?.offsetTop ?? 0;
    const viewportWidth = view?.width ?? window.innerWidth;
    const viewportHeight = view?.height ?? window.innerHeight;
    const gap = 8;
    const margin = 8;
    const anchorRect = anchor.getBoundingClientRect();

    // Limit the height to the *visible* viewport, including while the keyboard is open.
    panel.style.setProperty('max-height', `${Math.max(80, viewportHeight - margin * 2)}px`, 'important');
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width;
    const panelHeight = panelRect.height;
    const rightEdge = viewportLeft + viewportWidth - margin;
    const bottomEdge = viewportTop + viewportHeight - margin;

    const left = Math.max(viewportLeft + margin,
        Math.min(anchorRect.right - panelWidth, rightEdge - panelWidth));
    const roomAbove = anchorRect.top - (viewportTop + margin);
    const roomBelow = bottomEdge - anchorRect.bottom;
    const top = roomAbove >= panelHeight + gap || roomAbove >= roomBelow
        ? Math.max(viewportTop + margin, anchorRect.top - panelHeight - gap)
        : Math.min(bottomEdge - panelHeight, anchorRect.bottom + gap);

    panel.style.setProperty('left', `${Math.round(left)}px`, 'important');
    panel.style.setProperty('top', `${Math.round(top)}px`, 'important');
    panel.style.visibility = 'visible';
}

let panelFrame = 0;
function schedulePanelPosition() {
    if (!document.querySelector('#qrp-panel') || panelFrame) return;
    panelFrame = requestAnimationFrame(() => {
        panelFrame = 0;
        positionPanel();
    });
}

// White Dome positions Quick Replies absolutely ABOVE the input form.
// Because our launcher is a sibling immediately before that form, their visual
// rectangles can overlap even though neither component is broken. Measure the
// *actual* Quick Replies bar and lift only the launcher when needed. Unlike a
// fixed 60px CSS offset, this works with wrapped quick replies and font scaling.
let launcherFrame = 0;
let launcherLift = 0;
const layoutObserved = new WeakSet();
const launcherResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => scheduleLauncherPosition())
    : null;

function observeLauncherLayout() {
    if (!launcherResizeObserver) return;
    for (const element of [
        document.querySelector('#qrp-launcher'),
        document.querySelector('#qr--bar'),
        document.querySelector('#send_form'),
    ]) {
        if (element && !layoutObserved.has(element)) {
            layoutObserved.add(element);
            launcherResizeObserver.observe(element);
        }
    }
}

function positionLauncher() {
    const shell = document.querySelector('#qrp-shell');
    const launcher = document.querySelector('#qrp-launcher');
    if (!shell || !launcher || !showLauncher) {
        launcherLift = 0;
        return;
    }
    const quickBar = document.querySelector('#qr--bar');
    let lift = 0;
    if (quickBar && quickBar.getClientRects().length > 0) {
        const quickRect = quickBar.getBoundingClientRect();
        const buttonRect = launcher.getBoundingClientRect();
        const gap = 9;
        // Undo our previous transform in the measurements. Without this,
        // recalculating the layout would alternate between two positions.
        const baselineTop = buttonRect.top + launcherLift;
        const baselineBottom = buttonRect.bottom + launcherLift;
        const horizontalOverlap = buttonRect.left < quickRect.right && buttonRect.right > quickRect.left;
        const verticalOverlap = baselineTop < quickRect.bottom + gap && baselineBottom > quickRect.top - gap;
        if (horizontalOverlap && verticalOverlap && quickRect.width > 0 && quickRect.height > 0) {
            lift = Math.max(0, baselineBottom - quickRect.top + gap);
            // Keep the launcher visible when the mobile keyboard reduces the viewport.
            const viewportTop = window.visualViewport?.offsetTop ?? 0;
            lift = Math.min(lift, Math.max(0, baselineTop - viewportTop - 8));
        }
    }
    lift = Math.ceil(lift);
    if (lift !== launcherLift) {
        shell.style.setProperty('transform', lift ? `translateY(-${lift}px)` : 'none', 'important');
        launcherLift = lift;
        schedulePanelPosition();
    }
}

function scheduleLauncherPosition() {
    if (launcherFrame || !showLauncher) return;
    launcherFrame = requestAnimationFrame(() => {
        launcherFrame = 0;
        observeLauncherLayout();
        positionLauncher();
    });
}

function close() {
    document.querySelector('#qrp-panel')?.remove();
    if (panelFrame) cancelAnimationFrame(panelFrame);
    panelFrame = 0;
    setLauncherExpanded(false);
}

function open() {
    close();
    const chars = members();
    if (!chars.length) return;
    mountLauncher();
    const shell = document.querySelector('#qrp-shell');
    if (!shell) return;
    const panel = document.createElement('div');
    panel.id = 'qrp-panel';
    panel.dataset.style = style;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Выбрать отвечающего');
    panel.style.visibility = 'hidden';
    const head = document.createElement('div');
    head.className = 'qrp-head';
    const title = document.createElement('span');
    title.textContent = 'Кто ответит?';
    head.append(title);
    panel.append(head);
    for (const char of chars) {
        const row = document.createElement('div');
        row.className = 'qrp-row';
        if (char.muted) row.classList.add('qrp-muted');
        const img = document.createElement('img');
        img.className = 'qrp-avatar';
        img.src = `/characters/${encodeURIComponent(char.avatar)}`;
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'qrp-name';
        name.textContent = char.name;
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'qrp-play';
        play.textContent = '▶';
        play.title = `Ответ: ${char.name}`;
        play.setAttribute('aria-label', play.title);
        play.onclick = async () => {
            if (play.disabled) return;
            const command = `/trigger ${JSON.stringify(char.name)}`;
            const ctx = getContext();
            const textarea = document.querySelector('#send_textarea');
            const draft = String(textarea?.value ?? '');
            try {
                play.disabled = true;
                if (draft.trim()) {
                    await sendMessageAsUser(draft);
                    textarea.value = '';
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (ctx?.executeSlashCommandsWithOptions) await ctx.executeSlashCommandsWithOptions(command);
                else if (ctx?.executeSlashCommands) await ctx.executeSlashCommands(command);
                else throw new Error('Команды SillyTavern недоступны');
                close();
            } catch (err) {
                play.disabled = false;
                console.error('[QuickReplyPicker] Send and trigger failed:', err);
                window.toastr?.error?.(`Не удалось отправить сообщение: ${err?.message || err}`);
            }
        };
        img.onclick = play.onclick;
        img.title = `Ответ: ${char.name}`;
        const eye = document.createElement('button');
        eye.type = 'button';
        eye.className = 'qrp-eye';
        eye.innerHTML = char.muted ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>'; 
        eye.title = char.muted ? `Включить ${char.name}` : `Отключить ${char.name}`;
        eye.setAttribute('aria-label', eye.title);
        eye.onclick = async () => {
            const command = `/${char.muted ? 'member-enable' : 'member-disable'} ${JSON.stringify(char.name)}`;
            const ctx = window.SillyTavern?.getContext?.();
            try {
                if (ctx?.executeSlashCommandsWithOptions) await ctx.executeSlashCommandsWithOptions(command);
                else if (ctx?.executeSlashCommands) await ctx.executeSlashCommands(command);
                else throw new Error('Команды SillyTavern недоступны');
                open();
            } catch (err) { console.error('[QuickReplyPicker] Mute failed:', err); }
        };
        row.append(img, name, play, eye);
        panel.append(row);
    }
    // Body portal avoids clipping/overlap from White Dome and similar themes.
    document.body.append(panel);
    positionPanel();
    setLauncherExpanded(true);
}

function mountLauncher() {
    const chars = members();
    if (!chars.length) {
        document.querySelector('#qrp-shell')?.remove();
        close();
        return;
    }

    // Match ImmersionDirector's group control: the whole control lives directly
    // before SillyTavern's input form and moves with its mobile layout.
    const anchor = document.querySelector('#send_form') || document.querySelector('#send_but_wrapper');
    if (!anchor) return;
    let shell = document.querySelector('#qrp-shell');
    if (!shell) {
        shell = document.createElement('div');
        shell.id = 'qrp-shell';
    }
    if (shell.nextElementSibling !== anchor) anchor.before(shell);

    if (!showLauncher) {
        shell.querySelector('#qrp-launcher')?.remove();
        shell.style.removeProperty('transform');
        launcherLift = 0;
        return;
    }

    const signature = chars.map(char => char.avatar).join('|');
    let launcher = shell.querySelector('#qrp-launcher');
    if (!launcher) {
        launcher = document.createElement('button');
        launcher.id = 'qrp-launcher';
        launcher.type = 'button';
        launcher.title = 'Выбрать отвечающего · v0.3.13';
        launcher.setAttribute('aria-label', 'Выбрать отвечающего');
        launcher.setAttribute('aria-expanded', 'false');
        launcher.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (document.querySelector('#qrp-panel')) close();
            else open();
        });
        shell.append(launcher);
    }

    if (launcher.dataset.members !== signature) {
        launcher.dataset.members = signature;
        launcher.replaceChildren();
        const avatars = document.createElement('span');
        avatars.className = 'qrp-launcher-avatars';
        for (const char of chars.slice(0, 3)) {
            const img = document.createElement('img');
            img.src = `/characters/${encodeURIComponent(char.avatar)}`;
            img.alt = '';
            avatars.append(img);
        }
        const arrow = document.createElement('span');
        arrow.className = 'qrp-launcher-arrow';
        arrow.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        launcher.append(avatars, arrow);
        setLauncherExpanded(Boolean(document.querySelector('#qrp-panel')));
    }
    scheduleLauncherPosition();
}

function attach(button) {
    if (button.dataset.qrpAttached) return;
    button.dataset.qrpAttached = '1';
    let timer = null;
    let fired = false;
    let touchActive = false;

    function startLongPress() {
        clearTimeout(timer);
        fired = false;
        if (!members().length) return;
        timer = setTimeout(() => {
            fired = true;
            open();
            navigator.vibrate?.(40);
            try { window.getSelection()?.removeAllRanges(); } catch (_) { }
        }, 500);
    }

    function cancelLongPress() {
        clearTimeout(timer);
    }

    button.addEventListener('touchstart', () => {
        touchActive = true;
        startLongPress();
    }, { capture: true, passive: false });

    button.addEventListener('touchend', event => {
        cancelLongPress();
        if (fired) {
            event.preventDefault();
            event.stopImmediatePropagation();
            fired = false;
        }
        setTimeout(() => { touchActive = false; }, 300);
    }, { capture: true, passive: false });

    button.addEventListener('touchcancel', () => {
        cancelLongPress();
        touchActive = false;
    }, { capture: true });

    button.addEventListener('touchmove', cancelLongPress, { capture: true, passive: true });

    button.addEventListener('mousedown', event => {
        if (event.button !== 0 || touchActive) return;
        startLongPress();
    }, { capture: true });

    button.addEventListener('mouseup', () => {
        if (!touchActive) cancelLongPress();
    }, { capture: true });
    button.addEventListener('mouseleave', cancelLongPress, { capture: true });

    button.addEventListener('click', e => {
        if (!fired) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        fired = false;
    }, true);
    button.addEventListener('contextmenu', event => {
        if (!fired) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

document.addEventListener('pointerdown', e => {
    if (e.target.closest('#qrp-panel, #qrp-launcher, #send_but')) return;
    close();
}, true);
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    close();
    closeSettings();
});
// Fixed menu follows its button when the mobile keyboard, viewport, or scroll moves.
for (const eventName of ['resize', 'scroll']) {
    window.addEventListener(eventName, () => {
        scheduleLauncherPosition();
        schedulePanelPosition();
    }, { passive: true, capture: eventName === 'scroll' });
    window.visualViewport?.addEventListener(eventName, () => {
        scheduleLauncherPosition();
        schedulePanelPosition();
    }, { passive: true });
}
new MutationObserver(() => {
    const button = document.querySelector('#send_but');
    if (button) attach(button);
    mountLauncher();
    mountMenuEntry();
}).observe(document.body, { childList: true, subtree: true });
const button = document.querySelector('#send_but');
if (button) attach(button);
mountLauncher();

function closeSettings() {
    const modal = document.querySelector('#qrp-settings-modal');
    if (!modal) return;
    if (modal.open) modal.close();
    modal.remove();
}

function openSettings() {
    closeSettings();

    const modal = document.createElement('dialog');
    modal.id = 'qrp-settings-modal';
    const dialog = document.createElement('div');
    dialog.id = 'qrp-settings-dialog';
    modal.setAttribute('aria-label', 'Настройки выбора отвечающего');

    const header = document.createElement('div');
    header.className = 'qrp-settings-header';
    const title = document.createElement('strong');
    title.textContent = 'Выбор отвечающего · 0.3.13';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'qrp-settings-close';
    closeButton.setAttribute('aria-label', 'Закрыть');
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeButton.addEventListener('click', closeSettings);
    header.append(title, closeButton);

    const styleLabel = document.createElement('label');
    styleLabel.textContent = 'Вид списка персонажей';
    const styleSelect = document.createElement('select');
    styleSelect.setAttribute('aria-label', 'Вид списка персонажей');
    for (const [value, label] of [['compact', 'Короткие строки'], ['bubbles', 'Кружки']]) {
        const option = new Option(label, value);
        styleSelect.add(option);
    }
    styleSelect.value = style;
    styleSelect.addEventListener('change', () => {
        style = styleSelect.value;
        localStorage.setItem(KEY, style);
        close();
    });

    const launcherLabel = document.createElement('label');
    launcherLabel.textContent = 'Как открывать список';
    const launcherSelect = document.createElement('select');
    launcherSelect.setAttribute('aria-label', 'Как открывать список');
    for (const [value, label] of [['arrow', 'Стрелка всегда'], ['hold', 'Только удержание отправки']]) {
        launcherSelect.add(new Option(label, value));
    }
    launcherSelect.value = showLauncher ? 'arrow' : 'hold';
    launcherSelect.addEventListener('change', () => {
        showLauncher = launcherSelect.value === 'arrow';
        localStorage.setItem(LAUNCHER_KEY, launcherSelect.value);
        close();
        mountLauncher();
    });

    const hint = document.createElement('p');
    hint.className = 'qrp-settings-hint';
    hint.textContent = 'Долгое нажатие отправки работает в обоих режимах.';

    dialog.append(header, styleLabel, styleSelect, launcherLabel, launcherSelect, hint);
    modal.append(dialog);
    modal.addEventListener('cancel', event => {
        event.preventDefault();
        closeSettings();
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) closeSettings();
    });
    document.body.append(modal);
    modal.showModal();
}

function mountMenuEntry() {
    document.querySelector('#qrp-settings')?.remove();
    const menu = document.querySelector('#extensionsMenu');
    if (!menu || document.querySelector('#qrp-menu-item-container')) return;

    const container = document.createElement('div');
    container.id = 'qrp-menu-item-container';
    container.className = 'extension_container interactable';
    container.tabIndex = 0;

    const button = document.createElement('div');
    button.id = 'qrp-menu-button';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.tabIndex = 0;
    button.innerHTML = '<i class="fa-solid fa-users menu_button extensionsMenuExtensionButton"></i><span>Выбор отвечающего</span>';
    button.addEventListener('click', openSettings);
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') openSettings();
    });

    container.append(button);
    menu.append(container);
}
mountMenuEntry();
