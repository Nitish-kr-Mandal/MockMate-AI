import express from "express"
import dotenv from "dotenv"

dotenv.config()

const app = express()

const PORT = process.env.PORT || 6000

app.get("/", (req, res) => {
    return res.json({message:"server is running"})
})

app.listen(PORT, () => {
    console.log(`server is running on port ${PORT}`)    
})

