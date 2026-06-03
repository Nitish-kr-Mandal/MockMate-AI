import multer from "multer"

const storage = multer.diskStorage({
    destination: function(req, file, cb){
        cb(null, "public")
    },
    filename: function(req, file, cb){
        const filename = Date.now() + "-" + file.originalname;
        cb(null, filename)
    }
})

const fileFilter = (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
        cb(null, true)
    } else {
        cb(new Error("Only PDF files are allowed"), false)
    }
}

export const upload = multer({
    storage,
    fileFilter,
    limits: {fileSize: 5 * 1024 * 1024}
})