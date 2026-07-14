/* Agent Usage Stat — inline SVG icons. */
import React from 'react'

const S = (p, vb?, sw?) => (props?) => {
  props = props || {}
  return React.createElement('svg', {
    width: props.s || 16, height: props.s || 16, viewBox: vb || '0 0 16 16',
    fill: 'none', stroke: 'currentColor', strokeWidth: sw || 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round', style: props.style,
  }, p.map((d, i) => React.createElement('path', { key: i, d })))
}
const Sraw = (children, vb?) => (props?) => {
  props = props || {}
  return React.createElement('svg', {
    width: props.s || 16, height: props.s || 16, viewBox: vb || '0 0 16 16',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round', style: props.style,
  }, children)
}

export const LHI = {
  Pulse: S(['M1 8h3l2-5 3 10 2-5h4']),                          // overview / heartbeat
  Coin: Sraw([                                                   // spend
    React.createElement('circle', { key: 0, cx: 8, cy: 8, r: 6 }),
    React.createElement('path', { key: 1, d: 'M8 4.8c-1 0-1.8.5-1.8 1.3 0 1.8 3.6.9 3.6 2.7 0 .8-.8 1.3-1.8 1.3s-1.8-.5-1.8-1.3' }),
    React.createElement('path', { key: 2, d: 'M8 4v8' }),
  ]),
  Bolt: S(['M9 1.5 3 9h4l-1 5.5L13 7H9l0-5.5Z']),               // tokens
  Folder: S(['M1.5 4.2c0-.6.5-1 1-1h3l1.4 1.6h6.6c.6 0 1 .5 1 1v6.4c0 .6-.5 1-1 1H2.5c-.6 0-1-.5-1-1V4.2Z']),
  Table: S(['M2 3.5h12v9H2z', 'M2 6.5h12', 'M6 6.5v6', 'M10 6.5v6']),
  Search: S(['M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M14 14l-3.5-3.5']),
  Clock: S(['M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13Z', 'M8 4.5V8l2.5 1.5']),
  Cpu: S(['M4.5 4.5h7v7h-7z', 'M6.5 1.5v2', 'M9.5 1.5v2', 'M6.5 12.5v2', 'M9.5 12.5v2', 'M1.5 6.5h2', 'M1.5 9.5h2', 'M12.5 6.5h2', 'M12.5 9.5h2']),
  Folders: S(['M8 1.7 14.5 5 8 8.3 1.5 5 8 1.7Z', 'M1.5 8 8 11.3 14.5 8', 'M1.5 11 8 14.3 14.5 11']),
  Close: S(['M3.5 3.5l9 9', 'M12.5 3.5l-9 9']),
  Chevron: S(['M5.5 3.5 10 8l-4.5 4.5']),
  Dot: Sraw([React.createElement('circle', { key: 0, cx: 8, cy: 8, r: 3, fill: 'currentColor', stroke: 'none' })]),
  Person: S(['M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8Z', 'M2.7 14c0-3 2.4-5 5.3-5s5.3 2 5.3 5']),
  Pin: S(['M8 14.5s4.5-4 4.5-7.5a4.5 4.5 0 1 0-9 0c0 3.5 4.5 7.5 4.5 7.5Z', 'M8 8.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z']),
}
