// Formatear errores de validación
function formatValidationErrors(errors) {
  return errors.array().map(err => ({ field: err.path, message: err.msg }));
}

// Verificar si un UUID es válido
function isValidUUID(uuid) {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

module.exports = { formatValidationErrors, isValidUUID };