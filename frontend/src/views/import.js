export function mountImport(app, navigate) {
  app.innerHTML = '<h1>Import</h1><button id="go-library">Back</button>'
  app.querySelector('#go-library').addEventListener('click', () => navigate('library'))
}
