const errorHandler = require('../errorHandler');

describe('errorHandler', () => {
  it('logs the error and responds with a generic 500 plus the request id', () => {
    const req = { id: 'req-1', log: { error: jest.fn() } };
    const res = { status: jest.fn(function () { return this; }), json: jest.fn() };
    const err = new Error('secret detail');

    errorHandler(err, req, res, jest.fn());

    expect(req.log.error).toHaveBeenCalledWith({ err }, expect.any(String));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal Server Error', requestId: 'req-1' });
  });
});
