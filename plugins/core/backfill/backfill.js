var n = require('numbro')
  , tb = require('timebucket')
  , parallel = require('run-parallel')

module.exports = function container (get, set, clear) {
  function backfill (options) {
    var command = get('commands.backfill')
    var get_products = get('utils.get_products')
    var log_trades = get('utils.log_trades')
    var rs = get('run_state')
    var c = get('constants')
    var config = get('config')
    rs.tick = tb(c.tick_size).toString()
    var tasks = get('exchanges').map(function (exchange) {
      return function task (cb) {
        var products = get_products(exchange)
        var tasks = products.map(function (product) {
          return function task (done) {
            try {
              var backfiller = get('exchanges.' + exchange.name + '.backfiller')
            }
            catch (e) {
              return done(null, [])
            }
            backfiller(product.id, options.limit, function (err, trades) {
              if (err) {
                err.exchange = exchange.name
                return done(err)
              }
              var tasks = trades.map(function (trade) {
                return function task (done) {
                  trade.id = exchange.name + '-' + config.asset + '-' + config.currency + '-' + trade.id
                  trade.asset = config.asset
                  trade.currency = config.currency
                  trade.exchange = exchange.name
                  trade.processed = false
                  get('motley:db.trades').save(trade, done)
                }
              })
              parallel(tasks, function (err) {
                if (err) return done(err)
                log_trades(exchange.name, trades)
                done()
              })
            })
          }
        })
        parallel(tasks, cb)
      }
    })
    parallel(tasks, function (err) {
      if (err) {
        get('logger').error('[' + err.exchange + ']', err.message, {public: false})
      }
      var timeout = setTimeout(function () {
        backfill(options)
      }, c.backfill_timeout)
      set('timeouts[]', timeout)
    })
  }
  return backfill
}