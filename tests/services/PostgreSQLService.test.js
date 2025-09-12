jest.mock('../../utils/logger');
const Logger = require('../../utils/logger');

// Mock pg Pool
const mockQuery = jest.fn();
const mockOn = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
      on: mockOn,
    })),
  };
});

const PostgreSQLService = require('../../services/PostgreSQLService');

describe('PostgreSQLService.testConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns success with table metrics on happy path', async () => {
    // Arrange: SELECT NOW, then COUNTs for links and dmMapping
    mockQuery
      .mockResolvedValueOnce({ rows: [{ current_time: '2025-09-10T00:00:00Z', version: 'PostgreSQL 16' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const svc = new PostgreSQLService({ host: 'h', port: 5432, database: 'd', user: 'u' });

    // Act
    const result = await svc.testConnection();

    // Assert
    expect(result.success).toBe(true);
    expect(result.version).toBe('PostgreSQL 16');
    expect(result.currentTime).toBe('2025-09-10T00:00:00Z');
    expect(result.tables.links).toEqual({
      success: true,
      responseTime: expect.any(Number),
      dataCount: 0,
    });
    expect(result.tables.dmMapping).toEqual({
      success: true,
      responseTime: expect.any(Number),
      dataCount: 1,
    });
    expect(Logger.success).toHaveBeenCalledWith('PostgreSQL connection healthy');
  });

  test('handles a table COUNT failure gracefully', async () => {
    // Arrange: SELECT NOW ok; links COUNT fails; dmMapping COUNT ok
    mockQuery
      .mockResolvedValueOnce({ rows: [{ current_time: 'now', version: 'v' }] })
      .mockRejectedValueOnce(new Error('links table missing'))
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const svc = new PostgreSQLService({ host: 'h', port: 5432, database: 'd', user: 'u' });

    // Act
    const result = await svc.testConnection();

    // Assert
    expect(result.success).toBe(true);
    expect(result.tables.links).toEqual({ success: false, responseTime: 0, error: 'links table missing' });
    expect(result.tables.dmMapping).toEqual({
      success: true,
      responseTime: expect.any(Number),
      dataCount: 2,
    });
  });

  test('returns failure when SELECT NOW fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const svc = new PostgreSQLService({ host: 'h', port: 5432, database: 'd', user: 'u' });

    const result = await svc.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('connection refused');
    expect(Logger.error).toHaveBeenCalledWith('PostgreSQL connection test failed:', 'connection refused');
  });
});
