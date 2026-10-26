jest.mock('../app', () => (req, res) => res.end());
jest.mock('../services/summarizeWorker', () => ({ close: jest.fn() }));
jest.mock('../services/indexingWorker', () => ({ close: jest.fn() }));
jest.mock('../socket', () => ({
  init: jest.fn(() => ({ on: jest.fn(), close: jest.fn(cb => cb && cb()) }))
}));
jest.mock('../model/BlogContent', () => ({ updateMany: jest.fn() }));

describe('server.js', () => {
  it('does not reset likes on startup', () => {
    require('../server');
    expect(require('../model/BlogContent').updateMany).not.toHaveBeenCalled();
  });

  it('does not listen when required as a module', () => {
    const { server } = require('../server');
    expect(server.listening).toBe(false);
  });
});
