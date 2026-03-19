export function mountPlay(app, navigate, positionId) {
  app.innerHTML = `<h1>Play #${positionId}</h1><button id="go-library">Back</button>`
  app.querySelector('#go-library').addEventListener('click', () => navigate('library'))
}
