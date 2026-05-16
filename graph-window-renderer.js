document.getElementById('btn-close-graph').addEventListener('click', () => window.api.closeWindow())

window.api.getGraphWindowData().then(({ nodes, edges }) => {
  document.getElementById('loading').remove()
  const svg = document.getElementById('graph-canvas')
  window.GraphRenderer.init(svg, { nodes, edges }, { onDblClick: () => {} })
})
