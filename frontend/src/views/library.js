export function mountLibrary(app, navigate) {
  app.innerHTML = '<h1>Library</h1><button id="go-import">Import Position</button>'
  app.querySelector('#go-import').addEventListener('click', () => navigate('import'))
}
