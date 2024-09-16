importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/wheels/bokeh-3.5.2-py3-none-any.whl', 'https://cdn.holoviz.org/panel/1.5.0/dist/wheels/panel-1.5.0-py3-none-any.whl', 'pyodide-http==0.2.1', 'hvplot', 'scipy']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  \nimport asyncio\n\nfrom panel.io.pyodide import init_doc, write_doc\n\ninit_doc()\n\nfrom panel import state as _pn__state\nfrom panel.io.handlers import CELL_DISPLAY as _CELL__DISPLAY, display, get_figure as _get__figure\n\nfrom io import BytesIO\n\nimport numpy as np\nimport pandas as pd\nimport holoviews as hv\nimport panel as pn\n\nfrom scipy.optimize import minimize\n\npn.extension('tabulator', design='material', template='material', loading_indicator=True)\nimport hvplot.pandas\n_pn__state._cell_outputs['a9b07d1c-444a-4148-aa9b-03a547acb799'].append("""## Load data""")\n@pn.cache\ndef get_stocks(data):\n    if data is None:\n        stock_file = 'https://datasets.holoviz.org/stocks/v1/stocks.csv'\n    else:\n        stock_file = BytesIO(data)\n    return pd.read_csv(stock_file, index_col='Date', parse_dates=True)\n\nfile_input = pn.widgets.FileInput(sizing_mode='stretch_width')\n\nstocks = hvplot.bind(get_stocks, file_input).interactive()\n\nselector = pn.widgets.MultiSelect(\n    name='Select stocks', sizing_mode='stretch_width',\n    options=stocks.columns.to_list()\n)\n\nselected_stocks = stocks.pipe(\n    lambda df, cols: df[cols] if cols else df, selector\n)\n_pn__state._cell_outputs['01630a8d-6683-4555-9271-26839b217faf'].append("""## Business logic""")\ndef compute_random_allocations(log_return, num_ports=15000):\n    _, ncols = log_return.shape\n    \n    # Compute log and mean return\n    mean_return = np.nanmean(log_return, axis=0)\n    \n    # Allocate normalized weights\n    weights = np.random.random((num_ports, ncols))\n    normed_weights = (weights.T / np.sum(weights, axis=1)).T\n    data = dict(zip(log_return.columns, normed_weights.T))\n\n    # Compute expected return and volatility of random portfolios\n    data['Return'] = expected_return = np.sum((mean_return * normed_weights) * 252, axis=1)\n    return_covariance = np.cov(log_return[1:], rowvar=False) * 252\n    if not return_covariance.shape:\n        return_covariance = np.array([[252.]])\n    data['Volatility'] = volatility = np.sqrt((normed_weights * np.tensordot(return_covariance, normed_weights.T, axes=1).T).sum(axis=1))\n    data['Sharpe'] = sharpe_ratio = expected_return/volatility\n    \n    df = pd.DataFrame(data)\n    df.attrs['mean_return'] = mean_return\n    df.attrs['log_return'] = log_return\n    return df\n\ndef check_sum(weights):\n    return np.sum(weights) - 1\n\ndef get_return(mean_ret, weights):\n    return np.sum(mean_ret * weights) * 252\n\ndef get_volatility(log_ret, weights):\n    return np.sqrt(np.dot(weights.T, np.dot(np.cov(log_ret[1:], rowvar=False) * 252, weights)))\n\ndef compute_frontier(df, n=30):\n    frontier_ret = np.linspace(df.Return.min(), df.Return.max(), n)\n    frontier_volatility = []\n\n    cols = len(df.columns) - 3\n    bounds = tuple((0, 1) for i in range(cols))\n    init_guess = [1./cols for i in range(cols)]\n    for possible_return in frontier_ret:\n        cons = (\n            {'type':'eq', 'fun': check_sum},\n            {'type':'eq', 'fun': lambda w: get_return(df.attrs['mean_return'], w) - possible_return}\n        )\n        result = minimize(lambda w: get_volatility(df.attrs['log_return'], w), init_guess, bounds=bounds, constraints=cons)\n        frontier_volatility.append(result['fun'])\n    return pd.DataFrame({'Volatility': frontier_volatility, 'Return': frontier_ret})\n\ndef minimize_difference(weights, des_vol, des_ret, log_ret, mean_ret):\n    ret = get_return(mean_ret, weights)\n    vol = get_volatility(log_ret, weights)\n    return abs(des_ret-ret) + abs(des_vol-vol)\n\n@pn.cache\ndef find_best_allocation(log_return, vol, ret):\n    cols = log_return.shape[1]\n    vol = vol or 0\n    ret = ret or 0\n    mean_return = np.nanmean(log_return, axis=0)\n    bounds = tuple((0, 1) for i in range(cols))\n    init_guess = [1./cols for i in range(cols)]\n    cons = (\n        {'type':'eq','fun': check_sum},\n        {'type':'eq','fun': lambda w: get_return(mean_return, w) - ret},\n        {'type':'eq','fun': lambda w: get_volatility(log_return, w) - vol}\n    )\n    opt = minimize(\n        minimize_difference, init_guess, args=(vol, ret, log_return, mean_return),\n        bounds=bounds, constraints=cons\n    )\n    ret = get_return(mean_return, opt.x)\n    vol = get_volatility(log_return, opt.x)\n    return pd.Series(list(opt.x)+[ret, vol], index=list(log_return.columns)+['Return', 'Volatility'], name='Weight')\n_pn__state._cell_outputs['89881e6f-218e-4ec3-923f-633de5b48f82'].append("""## Declare UI components""")\nn_samples = pn.widgets.IntSlider(\n    name='Random samples', value=10_000, start=1000, end=20_000, step=1000, sizing_mode='stretch_width'\n)\nbutton = pn.widgets.Button(name='Run Analysis', sizing_mode='stretch_width')\nposxy = hv.streams.Tap(x=None, y=None)\n\ntext = """\n#  Portfolio optimization\n\nThis application performs portfolio optimization given a set of stock time series.\n\nTo optimize your portfolio:\n\n1. Upload a CSV of the daily stock time series for the stocks you are considering\n2. Select the stocks to be included.\n3. Run the Analysis\n4. Click on the Return/Volatility plot to select the desired risk/reward profile\n\nUpload a CSV containing stock data:\n"""\n\nexplanation = """\nThe code for this app was taken from [this excellent introduction to Python for Finance](https://github.com/PrateekKumarSingh/Python/tree/master/Python%20for%20Finance/Python-for-Finance-Repo-master).\nTo learn some of the background and theory about portfolio optimization see [this notebook](https://github.com/PrateekKumarSingh/Python/blob/master/Python%20for%20Finance/Python-for-Finance-Repo-master/09-Python-Finance-Fundamentals/02-Portfolio-Optimization.ipynb).\n"""\n\nsidebar = pn.layout.WidgetBox(\n    pn.pane.Markdown(text, margin=(0, 10)),\n    file_input,\n    selector,\n    n_samples,\n    explanation,\n    max_width=350,\n    sizing_mode='stretch_width'\n).servable(area='sidebar')\n\n_pn__state._cell_outputs['66abc13d-ba6f-47bf-85d4-9cdd2f804f27'].append((sidebar))\nfor _cell__out in _CELL__DISPLAY:\n    _pn__state._cell_outputs['66abc13d-ba6f-47bf-85d4-9cdd2f804f27'].append(_cell__out)\n_CELL__DISPLAY.clear()\n_fig__out = _get__figure()\nif _fig__out:\n    _pn__state._cell_outputs['66abc13d-ba6f-47bf-85d4-9cdd2f804f27'].append(_fig__out)\n\n_pn__state._cell_outputs['6f641fd3-d39a-44cf-8784-b681b868ea7b'].append("""## Plot""")\n_pn__state._cell_outputs['1df1811f-09b8-41d1-8f22-a6bb0b802c25'].append("""### Portfolio optimization plot""")\n# Set up data pipelines\nlog_return = np.log(selected_stocks/selected_stocks.shift(1))\nrandom_allocations = log_return.pipe(compute_random_allocations, n_samples)\nclosest_allocation = log_return.pipe(find_best_allocation, posxy.param.x, posxy.param.y)\nefficient_frontier = random_allocations.pipe(compute_frontier)\nmax_sharpe = random_allocations.pipe(lambda df: df[df.Sharpe==df.Sharpe.max()])\n\n# Generate plots\nopts = {'x': 'Volatility', 'y': 'Return', 'responsive': True}\n\nallocations_scatter = random_allocations.hvplot.scatter(\n    alpha=0.1, color='Sharpe', cmap='plasma', **opts\n).dmap().opts(tools=[])\n\nfrontier_curve = efficient_frontier.hvplot(\n    line_dash='dashed', color='green', **opts\n).dmap()\n\nmax_sharpe_point = max_sharpe.hvplot.scatter(\n    line_color='black', size=50, **opts\n).dmap()\n\nclosest_point = closest_allocation.to_frame().T.hvplot.scatter(color='green', line_color='black', size=50, **opts).dmap()\n\nposxy.source = allocations_scatter\n\nsummary = pn.pane.Markdown(\n    pn.bind(lambda p: f"""\n    The selected portfolio has a volatility of {p.Volatility:.2f}, a return of {p.Return:.2f}\n    and Sharpe ratio of {p.Return/p.Volatility:.2f}.""", closest_allocation), width=250\n)\n\ntable = pn.widgets.Tabulator(closest_allocation.to_frame().iloc[:-2])\n\nplot = (allocations_scatter * frontier_curve * max_sharpe_point * closest_point).opts(min_height=400, show_grid=True)\n\n_pn__state._cell_outputs['2694f7ef-44a4-40e5-9822-61a259cc7dfe'].append((pn.Row(plot, pn.Column(summary, table), sizing_mode='stretch_both')))\nfor _cell__out in _CELL__DISPLAY:\n    _pn__state._cell_outputs['2694f7ef-44a4-40e5-9822-61a259cc7dfe'].append(_cell__out)\n_CELL__DISPLAY.clear()\n_fig__out = _get__figure()\nif _fig__out:\n    _pn__state._cell_outputs['2694f7ef-44a4-40e5-9822-61a259cc7dfe'].append(_fig__out)\n\n_pn__state._cell_outputs['dfb3a77b-1b00-4aa5-8af3-45ff188388e4'].append("""### Portfolio Performance plot""")\ninvestment = pn.widgets.Spinner(name='Investment Value in $', value=5000, step=1000, start=1000, end=100000)\nyear = pn.widgets.DateRangeSlider(name='Year', value=(stocks.index.min().eval(), stocks.index.max().eval()), start=stocks.index.min(), end=stocks.index.max())\n\nstocks_between_dates = selected_stocks[year.param.value_start:year.param.value_end]\nprice_on_start_date = selected_stocks[year.param.value_start:].iloc[0]\nallocation = (closest_allocation.iloc[:-2] * investment)\n\nperformance_plot = (stocks_between_dates * allocation / price_on_start_date).sum(axis=1).rename().hvplot.line(\n    ylabel='Total Value ($)', title='Portfolio performance', responsive=True, min_height=400\n).dmap()\n\nperformance = pn.Column(\n    pn.Row(year, investment),\n    performance_plot,\n    sizing_mode='stretch_both'\n)\n\n_pn__state._cell_outputs['60a4e495-4151-4b91-a51f-b8d921fe96ce'].append((performance))\nfor _cell__out in _CELL__DISPLAY:\n    _pn__state._cell_outputs['60a4e495-4151-4b91-a51f-b8d921fe96ce'].append(_cell__out)\n_CELL__DISPLAY.clear()\n_fig__out = _get__figure()\nif _fig__out:\n    _pn__state._cell_outputs['60a4e495-4151-4b91-a51f-b8d921fe96ce'].append(_fig__out)\n\n_pn__state._cell_outputs['0d4f92af-8ab6-441d-837a-120c1c362c50'].append("""### Plot stock prices""")\ntimeseries = selected_stocks.hvplot.line(\n    'Date', group_label='Stock', value_label='Stock Price ($)', title='Daily Stock Price',\n    min_height=300, responsive=True, grid=True, legend='top_left'\n).dmap()\n\n_pn__state._cell_outputs['40fe832a-45c4-4dc6-a5a7-877d40486257'].append((timeseries))\nfor _cell__out in _CELL__DISPLAY:\n    _pn__state._cell_outputs['40fe832a-45c4-4dc6-a5a7-877d40486257'].append(_cell__out)\n_CELL__DISPLAY.clear()\n_fig__out = _get__figure()\nif _fig__out:\n    _pn__state._cell_outputs['40fe832a-45c4-4dc6-a5a7-877d40486257'].append(_fig__out)\n\n_pn__state._cell_outputs['c7d3360b-8c31-4433-ab44-ec5a819aa252'].append("""### Log return plots""")\nlog_ret_hists = log_return.hvplot.hist(min_height=300, min_width=400, responsive=True, bins=100, subplots=True, group_label='Stock').cols(2).opts(sizing_mode='stretch_both').panel()\n\n_pn__state._cell_outputs['62793c41-c536-42ac-bd09-4aed9d8759f2'].append((log_ret_hists))\nfor _cell__out in _CELL__DISPLAY:\n    _pn__state._cell_outputs['62793c41-c536-42ac-bd09-4aed9d8759f2'].append(_cell__out)\n_CELL__DISPLAY.clear()\n_fig__out = _get__figure()\nif _fig__out:\n    _pn__state._cell_outputs['62793c41-c536-42ac-bd09-4aed9d8759f2'].append(_fig__out)\n\n_pn__state._cell_outputs['0fd69653-d22d-4e3a-9c21-a843c911399f'].append("""### Overall layout""")\nmain = pn.Tabs(\n    ('Analysis', pn.Column(\n            pn.Row(\n                plot, pn.Column(summary, table),\n                sizing_mode='stretch_both'\n            ),\n            performance,\n            sizing_mode='stretch_both'\n        )\n    ),\n    ('Timeseries', timeseries),\n    ('Log Return', pn.Column(\n        '## Daily normalized log returns',\n        'Width of distribution indicates volatility and center of distribution the mean daily return.',\n        log_ret_hists,\n        sizing_mode='stretch_both'\n    )),\n    sizing_mode='stretch_both', min_height=1000\n).servable(title='Portfolio Optimizer')\n\n_pn__state._cell_outputs['e746c44f-9aa0-4704-bc9d-6358e9717068'].append((pn.Row(sidebar, main)))\nfor _cell__out in _CELL__DISPLAY:\n    _pn__state._cell_outputs['e746c44f-9aa0-4704-bc9d-6358e9717068'].append(_cell__out)\n_CELL__DISPLAY.clear()\n_fig__out = _get__figure()\nif _fig__out:\n    _pn__state._cell_outputs['e746c44f-9aa0-4704-bc9d-6358e9717068'].append(_fig__out)\n\n\nawait write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.globals.set('patch', msg.patch)
    self.pyodide.runPythonAsync(`
    from panel.io.pyodide import _convert_json_patch
    state.curdoc.apply_json_patch(_convert_json_patch(patch), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.globals.set('location', msg.location)
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads(location)
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()