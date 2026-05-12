import { expect } from 'chai';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { Store } from '../src/store';

describe('StatusBarPresenter', () => {
  let store: Store;
  let presenter: StatusBarPresenter;

  beforeEach(() => {
    store = new Store();
    presenter = new StatusBarPresenter(store);
  });

  afterEach(() => {
    presenter.dispose();
  });

  it('renders loading state initially', () => {
    // itemWeekly text was set to spinner in constructor, then render(defaultState) runs
    const weeklyText = (presenter as any).itemWeekly.text;
    expect(weeklyText).to.include('Kimi');
  });

  it('hides window item when auth missing', () => {
    store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
    const hidden = (presenter as any).itemWindow.text === '';
    expect(hidden).to.be.true;
  });

  it('shows weekly percentage after API_SUCCESS', () => {
    store.dispatch({
      type: 'API_SUCCESS',
      payload: {
        weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
        windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
        parallelLimit: 30,
      },
    });
    const weeklyText = (presenter as any).itemWeekly.text as string;
    expect(weeklyText).to.include('25.0%');
  });
});
