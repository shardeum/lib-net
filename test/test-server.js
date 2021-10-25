const Sn = require('../.')

const address = '127.0.0.1'
const port = 5001

const sn = Sn.Sn({
  address,
  port
})

// net.listen(port, address, (data) => console.log(data));

const main = async () => {
  await sn.listen((data) => {
      console.log("Received: ", data.length)
  })
}

main()

function wait() {
  setTimeout(wait, 1000);
};

wait()
