require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: '*'
}));

const mongoose = require('mongoose');
const swaggerDocs = require('./swagger');
const AWS = require('aws-sdk');
const { logInfo, logError } = require('./logger');

app.use(express.json());

/**
* @swagger
* tags:
*   - name: CRUD MongoDb
*     description: Operações de CRUD para usuários no MongoDb.
*   - name: Buckets
*     description: Operações de Listar buckets, upload e remoção de arquivo para um bucket S3.
*/

//#region CRUD MongoDb
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => logInfo('MongoDB conectado', null))
  .catch(err => logError('Erro ao logar mongodb' + err, null, err));

const UserSchema = new mongoose.Schema({
    name: String,  // <- atualizado de 'nome' para 'name'
    email: String
});

const User = mongoose.model('Usuario', UserSchema);

app.get('/mongodb/testar-conexao', async (req, res) => {
    try {
        await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        const user = await User.findOne();
        logInfo('Conexão com o MongoDB efetuada com sucesso', req);
        if (user) {
            res.status(200).send('Conexão com o MongoDB bem-sucedida e usuário encontrado!');
        } else {
            res.status(200).send('Conexão com o MongoDB bem-sucedida, mas nenhum usuário encontrado.');
        }
    } catch (error) {
        await logError('Erro ao conectar no MongoDb' + error, req, error);
        res.status(500).send('Erro na conexão com o MongoDB');
    } finally {
        mongoose.connection.close();
    }
});

app.post('/usuarios', async (req, res) => {
    try {
        const { name, email } = req.body;
        if (!name || !email) {
            return res.status(400).json({ message: 'Nome e email são obrigatórios.' });
        }

        const user = new User({ name, email });
        await user.save();

        logInfo('Usuário criado', req);
        res.status(201).send(user);
    } catch (error) {
        logError("Erro ao criar usuário", req, error);
        res.status(500).json({ message: 'Erro ao criar usuário', error: error.message });
    }
});

app.get('/usuarios', async (req, res) => {
    try {
        const users = await User.find();
        logInfo('Usuários encontrados', req, users);
        res.send(users);
    } catch (error) {
        logError("Erro ao buscar usuários", req, error);
        res.status(500).send('Ocorreu um erro interno');
    }
});

app.get('/usuarios/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).send('Usuário não encontrado');

        logInfo('Usuário encontrado', req, user);
        res.send(user);
    } catch (error) {
        logError("Erro ao buscar usuário", req, error);
        res.status(500).send('Ocorreu um erro interno');
    }
});

app.put('/usuarios/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!user) return res.status(404).send('Usuário não encontrado');

        logInfo('Usuário atualizado', req, user);
        res.send(user);
    } catch (error) {
        logError("Erro ao atualizar usuário", req, error);
        res.status(500).send('Ocorreu um erro interno');
    }
});

app.delete('/usuarios/:id', async (req, res) => {
    try {
        const result = await User.deleteOne({ _id: req.params.id });
        if (result.deletedCount === 0) {
            return res.status(404).send('Usuário não encontrado');
        }

        logInfo('Usuário removido', req);
        res.send({ message: 'Usuário removido com sucesso' });
    } catch (error) {
        logError("Erro ao remover usuário", req, error);
        res.status(500).send('Ocorreu um erro interno');
    }
});
//#endregion

//#region Buckets
AWS.config.update({
    region: process.env.REGION
});

const s3 = new AWS.S3();

const upload = multer({ storage: multer.memoryStorage() });

app.get('/buckets', async (req, res) => {
    try {
        const data = await s3.listBuckets().promise();
        logInfo('Buckets encontrados', req, data.Buckets);
        res.status(200).json(data.Buckets);
    } catch (error) {
        logError("Erro ao buscar buckets", req, error);
        res.status(500).json({ error: 'Erro ao listar buckets', details: error });
    }
});

app.get('/buckets/:bucketName', async (req, res) => {
    const { bucketName } = req.params;
    const params = { Bucket: bucketName };

    try {
        const data = await s3.listObjectsV2(params).promise();
        logInfo('Objetos encontrados', req, data.Contents);
        res.status(200).json(data.Contents);
    } catch (error) {
        logError("Erro ao buscar objetos", req, error);
        res.status(500).json({ error: 'Erro ao listar objetos do bucket', details: error });
    }
});

app.post('/buckets/:bucketName/upload', upload.single('file'), async (req, res) => {
    const { bucketName } = req.params;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    }

    const params = {
        Bucket: bucketName,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
    };
    try {
        const data = await s3.upload(params).promise();
        logInfo('Upload efetuado', req, data);
        res.status(200).json({ message: 'Upload concluído com sucesso', data });
    } catch (error) {
        logError('Erro ao efetuar upload', req, error);
        res.status(500).json({ message: 'Erro no upload', error: error.message });
    }
});

app.delete('/buckets/:bucketName/file/:fileName', async (req, res) => {
    const { bucketName, fileName } = req.params;
    const params = {
        Bucket: bucketName,
        Key: fileName
    };

    try {
        await s3.deleteObject(params).promise();
        logInfo('Objeto removido', req);
        res.status(200).json({ message: 'Arquivo deletado com sucesso' });
    } catch (error) {
        logError("Erro ao remover objeto", req, error);
        res.status(500).json({ message: 'Erro ao remover arquivo', error: error.message });
    }
});
//#endregion

swaggerDocs(app);
app.listen(3000, () => console.log('Servidor rodando na porta 3000'));
