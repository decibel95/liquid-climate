import { css } from 'lit';
import { glassTokens } from '../../ui/glass-styles';
import { menuStyles } from '../../ui/menu';

export const dialStyles = css`
  ${glassTokens}
  ${menuStyles}

  :host {
    display: block;
    --lc-radius-default: 40px;
  }

  .lc {
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: 'tnum' 1;
    position: relative;
    box-sizing: border-box;
    max-width: 444px;
    margin: 0 auto;
    padding: 22px;
    border-radius: var(--lc-radius, var(--lc-radius-default));
    color: var(--lc-fg);
    background: var(--lc-bg);
    backdrop-filter: blur(var(--lc-blur, var(--_blur))) saturate(170%);
    -webkit-backdrop-filter: blur(var(--lc-blur, var(--_blur))) saturate(170%);
    border: 1px solid var(--lc-edge);
    box-shadow:
      inset 0 1px 0 var(--lc-shine),
      var(--lc-drop, 0 40px 80px -24px rgba(0, 0, 0, 0.45));
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }

  .glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.4s ease;
    background: radial-gradient(circle at var(--mx, 50%) var(--my, 50%), var(--lc-glow), transparent 40%);
  }
  .glow.on {
    opacity: 1;
  }
  .m-minimal .glow {
    display: none;
  }

  .tint {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    transition:
      background-color 0.9s ease,
      opacity 0.9s ease;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
    margin: 0;
    border: 1px solid var(--lc-btn-edge);
    background: var(--lc-btn);
  }
  button:focus-visible,
  .dial:focus-visible {
    outline: 2px solid var(--lc-bright);
    outline-offset: 2px;
  }
  button:disabled {
    cursor: default;
  }
  .press {
    transition:
      transform 0.28s cubic-bezier(0.3, 1.7, 0.5, 1),
      background-color 0.5s ease,
      border-color 0.5s ease;
  }
  .press:active:not(:disabled) {
    transform: scale(0.93);
  }

  header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  header .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  header .sub {
    font-size: 13px;
    color: var(--lc-fg2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  header .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .power {
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .dial-wrap {
    position: relative;
    width: 100%;
    max-width: 400px;
    aspect-ratio: 1;
    margin: 0 auto;
    container-type: inline-size;
  }
  .parts {
    position: absolute;
    left: 23.75%;
    top: 23.75%;
    width: 52.5%;
    height: 52.5%;
    border-radius: 50%;
    overflow: hidden;
    -webkit-mask-image: radial-gradient(circle, #000 50%, transparent 70%);
    mask-image: radial-gradient(circle, #000 50%, transparent 70%);
    pointer-events: none;
  }
  .pt {
    position: absolute;
    border-radius: 50%;
    opacity: 0;
    animation-iteration-count: infinite;
    animation-timing-function: ease-in-out;
  }
  .pt-off,
  .pt-auto-none {
    display: none;
  }
  .pt-heat,
  .pt-heat_cool,
  .pt-auto {
    bottom: -8px;
    animation-name: lcRise;
  }
  .pt-cool {
    top: -8px;
    animation-name: lcFall;
  }
  .pt-dry {
    top: -8px;
    animation-name: lcDrip;
    border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  }
  .pt-fan_only {
    bottom: 40%;
    animation-name: lcDrift;
  }
  @keyframes lcRise {
    0% { transform: translateY(0) scale(0.5); opacity: 0; }
    20% { opacity: 0.55; }
    100% { transform: translate(10px, -230px) scale(1.1); opacity: 0; }
  }
  @keyframes lcFall {
    0% { transform: translate(0, 0); opacity: 0; }
    20% { opacity: 0.6; }
    50% { transform: translate(8px, 110px); }
    100% { transform: translate(-6px, 230px); opacity: 0; }
  }
  @keyframes lcDrip {
    0% { transform: translateY(0) scaleY(0.8); opacity: 0; }
    15% { opacity: 0.55; }
    100% { transform: translateY(230px) scaleY(1.3); opacity: 0; }
  }
  @keyframes lcDrift {
    0% { transform: translateX(-70px); opacity: 0; }
    25% { opacity: 0.45; }
    100% { transform: translateX(150px); opacity: 0; }
  }

  .dial {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
    border-radius: 50%;
  }
  .dial.nodrag {
    cursor: default;
  }
  .spin {
    transform-box: fill-box;
    transform-origin: center;
    animation: lcSpin linear infinite;
  }
  @keyframes lcSpin {
    to { transform: rotate(360deg); }
  }
  .fan-label,
  .tick-label {
    position: absolute;
    text-align: center;
    pointer-events: none;
    font-size: 10px;
    transform: translate(-50%, -50%);
  }
  .fan-label {
    font-weight: 600;
    width: 20px;
  }
  .tick-label {
    color: var(--lc-fg3);
    width: 24px;
  }
  .fan-label,
  .tick-label,
  .center {
    transition: opacity 0.3s;
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-bottom: 6cqw;
    box-sizing: border-box;
    pointer-events: none;
  }
  .big {
    display: flex;
    align-items: flex-start;
    font-weight: 200;
    letter-spacing: -0.04em;
    line-height: 1;
    font-size: 18cqw;
    white-space: nowrap;
  }
  .big.dual {
    font-size: 11.5cqw;
    align-items: center;
    gap: 1.5cqw;
  }
  .big .deg {
    font-size: 7cqw;
    font-weight: 300;
    margin-top: 1.5cqw;
    color: var(--lc-fg2);
  }
  .big.dual .deg {
    font-size: 4.5cqw;
    margin-top: 0;
  }
  .big .dash {
    width: 3cqw;
    height: 1px;
    background: var(--lc-fg3);
  }
  .pop {
    animation: lcPop 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  @keyframes lcPop {
    0% { transform: scale(0.95); }
    100% { transform: scale(1); }
  }
  .centersub > span:not(.progress) {
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .centersub {
    position: relative;
    margin-top: 10px;
    height: 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--lc-fg2);
  }
  .progress {
    position: absolute;
    left: 50%;
    bottom: -8px;
    width: 56px;
    margin-left: -28px;
    height: 2px;
    border-radius: 1px;
    background: var(--lc-track);
    overflow: hidden;
  }
  .progress span {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--lc-bright);
    transform-origin: left;
    animation: lcFill var(--delay, 1.5s) linear forwards;
  }
  @keyframes lcFill {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }

  .steps {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2%;
    display: flex;
    justify-content: center;
    gap: 19%;
  }
  .step {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .step:disabled {
    opacity: 0.3;
  }

  .modes {
    position: relative;
    display: grid;
    gap: 6px;
  }
  .mode {
    height: 60px;
    border-radius: 18px;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
  }
  .mode span {
    font-size: 11px;
    font-weight: 500;
    max-width: 100%;
    min-width: 0;
    padding: 0 2px;
    box-sizing: border-box;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chips {
    position: relative;
    display: grid;
    gap: 6px;
  }
  .chip {
    height: 52px;
    border-radius: 16px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 9px;
    text-align: left;
    min-width: 0;
  }
  .chip .txt {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .chip .k {
    font-size: 11px;
    color: var(--lc-fg3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip .v {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip svg {
    flex: none;
    opacity: 0.85;
  }
  .osc {
    animation: lcOsc 1.6s ease-in-out infinite;
    transform-origin: center;
  }
  .osc-slow {
    animation: lcOsc 3.4s ease-in-out infinite;
    transform-origin: center;
  }
  @keyframes lcOsc {
    0%, 100% { transform: rotate(-16deg); }
    50% { transform: rotate(16deg); }
  }
  .climb {
    animation: lcClimb 1.9s ease-in-out infinite;
  }
  @keyframes lcClimb {
    0% { transform: translateY(3px); opacity: 0.4; }
    50% { opacity: 1; }
    100% { transform: translateY(-3px); opacity: 0.4; }
  }

  .info {
    position: relative;
    display: grid;
    border-top: 1px solid var(--lc-line);
    padding-top: 14px;
  }
  .info div {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .info .v {
    font-size: 18px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info .v small {
    font-size: 12px;
    color: var(--lc-fg2);
  }
  .info .v.warn {
    color: var(--lc-warn);
  }
  .info .l {
    font-size: 11.5px;
    color: var(--lc-fg3);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alert {
    position: relative;
    border-radius: 14px;
    background: rgba(248, 113, 113, 0.16);
    border: 1px solid rgba(248, 113, 113, 0.45);
    padding: 9px 12px;
    font-size: 13px;
  }

  .alert.battery {
    background: color-mix(in srgb, var(--lc-warn) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--lc-warn) 45%, transparent);
    color: var(--lc-warn);
  }

  .status {
    position: relative;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--lc-line);
  }
  .status .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-width: 0;
    padding: 12px 0;
    border: none;
    border-bottom: 1px solid var(--lc-line2);
    border-radius: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .status .row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .status .ric {
    --mdc-icon-size: 16px;
    width: 16px;
    height: 16px;
    flex: none;
    opacity: 0.7;
    margin-right: -4px;
  }
  .status .lbl {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--lc-fg2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status .val {
    flex: 0 1 auto;
    max-width: 55%;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    font-weight: 500;
  }
  .status .vt {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--lc-bright);
  }
  .status .unit {
    font-size: inherit;
    opacity: 0.65;
  }
  .status .muted {
    opacity: 0.5;
  }

  .unavailable {
    padding: 24px;
    text-align: center;
    color: var(--lc-fg2);
  }

  :host([data-paused]) .pt,
  :host([data-paused]) .spin,
  :host([data-paused]) .osc,
  :host([data-paused]) .osc-slow,
  :host([data-paused]) .climb {
    animation-play-state: paused;
  }
  svg [role='slider']:focus-visible {
    outline: 2px solid var(--lc-bright);
    outline-offset: 3px;
  }

  .m-subtle .pt,
  .m-minimal .pt {
    display: none;
  }
  .m-minimal .spin,
  .m-minimal .osc,
  .m-minimal .osc-slow,
  .m-minimal .climb {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .glow {
      display: none;
    }
    .pt {
      display: none;
    }
    .spin,
    .osc,
    .osc-slow,
    .climb,
    .pop {
      animation: none;
    }
    .press,
    .tint {
      transition: none;
    }
  }
`;
