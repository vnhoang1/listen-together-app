#playerWrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 18px;
}

#player {
  position: absolute;
  inset: 0;
  z-index: 1;
}

#player iframe {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
}

#playerShield {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: transparent;
  pointer-events: auto;
  cursor: default;
  user-select: none;
}
