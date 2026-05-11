import { expect } from 'chai';
import * as sinon from 'sinon';
import { Scheduler } from '../src/services/scheduler';
import { Store } from '../src/store';
import { AuthService } from '../src/services/authService';
import { ApiService } from '../src/services/apiService';
import { CacheService } from '../src/services/cacheService';
import { makeContext } from './mocks/vscode';

describe('Scheduler', () => {
  let clock: sinon.SinonFakeTimers;
  let store: Store;
  let auth: AuthService;
  let api: ApiService;
  let cache: CacheService;
  let scheduler: Scheduler;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    store = new Store();
    auth = AuthService.getInstance();
    api = ApiService.getInstance();
    cache = new CacheService();
    scheduler = new Scheduler(store, auth, api, cache);
  });

  afterEach(() => {
    scheduler.stop();
    clock.restore();
    sinon.restore();
    (AuthService as any).instance = undefined;
    (ApiService as any).instance = undefined;
    (CacheService as any).instance = undefined;
  });

  it('tick dispatches LOADING_START -> API_SUCCESS -> LOADING_END', async () => {
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

    const quota = {
      weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
      windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
      parallelLimit: 30,
    };
    const fetchStub = sinon.stub(api, 'fetchQuota').resolves({ ok: true, data: quota });
    sinon.stub(cache, 'write').resolves();

    let loadingEndSeen = false;
    store.subscribe((s) => {
      if (!s.isLoading && s.dataSource === 'api') {
        loadingEndSeen = true;
      }
    });

    scheduler.start();
    await clock.tickAsync(100); // trigger first tick
    await Promise.resolve();
    await Promise.resolve();

    expect(loadingEndSeen || store.getState().dataSource === 'api').to.be.true;
    expect(store.getState().quota).to.not.be.null;

    fetchStub.restore();
  });

  it('pauses tick when isPaused is true', async () => {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    scheduler.start();
    await clock.tickAsync(100);
    expect(store.getState().dataSource).to.equal('no-data');
  });
});
