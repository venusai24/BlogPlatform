// validate(schema, source = 'body'): parse req[source] with a zod schema.
// On failure respond 400 { message, issues }; on success replace req[source] with the parsed value
// (trimmed strings, coerced numbers, defaults applied, unknown keys stripped).
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        message: 'Invalid request',
        issues: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }
    if (source === 'query') {
      // req.query is a getter in some Express setups, so plain assignment is not reliable.
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true, enumerable: true });
    } else {
      req[source] = result.data;
    }
    next();
  };
}

module.exports = validate;
